// The y-quorum client: one WebSocket per tab carrying any number of documents.
//
// Each document is held once, as one Y.Doc, however many views open it: views
// get handles that share it, and the document is closed a short while after
// the last handle is released, so a list that re-renders does not reopen it.
// A connection that drops is reopened, and every document with it; what the
// server is missing is worked out again from state vectors, so nothing is
// queued for resending.
import * as Y from '@y/y'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates
} from '@y/protocols/awareness'
import {
  PROTOCOL_VERSION,
  ToClient,
  ToServer,
  decodeFrame,
  encodeFrame,
  isFrame,
  type ActorClaim,
  type Capabilities,
  type DocumentRecord,
  type Frame,
  type Headers,
  type Limits,
  type PresenceEntry,
  type Principal,
  type ReasonCode
} from './protocol'

export type Status = 'connecting' | 'connected' | 'disconnected' | 'closed'
export type Welcome = Headers[typeof ToClient.WELCOME]

export interface ClientOptions {
  url: string
  token: string | (() => string | Promise<string>)
  /** A WebSocket implementation; the global one by default */
  WebSocket?: typeof WebSocket
  /** Milliseconds a released document stays open, in case it is opened again */
  grace?: number
}

/** A refusal, with its reason code */
export class QuorumError extends Error {
  readonly code: ReasonCode

  constructor(code: ReasonCode, reason: string) {
    super(reason)
    this.name = 'QuorumError'
    this.code = code
  }
}

export interface Refusal {
  code: ReasonCode
  reason: string
}

/** Changes the server refused, or would no longer accept, handed to the app */
export interface Rejection extends Refusal {
  /** The refused update and every unacknowledged update after it, in order */
  updates: Uint8Array[]
  /** When what was refused is a record rather than a change */
  record?: { kind: string, data: unknown }
}

export interface ClientEvents {
  status: Status
  refused: Refusal
}

export interface DocumentEvents {
  capabilities: Capabilities
  /** The records just appended */
  records: DocumentRecord[]
  message: unknown
  rejected: Rejection
  /** The document was replaced: bind to `handle.doc` and `handle.awareness` again */
  rebuilt: { doc: Y.Doc }
  /** Every local change is stored; `log` is the position of the last one, when known */
  saved: { log?: number }
  /** The server closed the document, or the client was closed for good */
  closed: Refusal
}

export interface WatchEvents {
  change: Record<string, unknown>
  closed: Refusal
}

export interface Client {
  /** Resolves at the first WELCOME, rejects when the connection is refused */
  readonly ready: Promise<Welcome>
  readonly principal: Principal | undefined
  readonly status: Status
  on<K extends keyof ClientEvents>(event: K, fn: (arg: ClientEvents[K]) => void): void
  off<K extends keyof ClientEvents>(event: K, fn: (arg: ClientEvents[K]) => void): void
  open(namespace: string, id: string): Promise<DocumentHandle>
  watch(namespace: string, id: string, paths: string[]): Promise<WatchHandle>
  presence(namespace: string, listener: (entries: PresenceEntry[]) => void): () => void
  rpc(name: string, args?: unknown): Promise<unknown>
  setToken(token: string): void
  close(): void
}

export interface DocumentHandle {
  readonly namespace: string
  readonly id: string
  readonly type: string
  readonly incarnation: string
  readonly doc: Y.Doc
  readonly content: Y.Node
  readonly awareness: Awareness
  readonly capabilities: Capabilities
  readonly records: DocumentRecord[]
  readonly hasUnsavedChanges: boolean
  /** An origin whose transactions are sent in frames of their own, carrying the claim */
  claimOrigin(claim: ActorClaim): object
  appendRecord(kind: string, data: unknown, claim?: ActorClaim): void
  setMode(mode: 'reading' | 'editing', visible?: boolean): void
  /** Makes a version holding everything this client has; resolves with its log position */
  save(label?: string): Promise<number>
  on<K extends keyof DocumentEvents>(event: K, fn: (arg: DocumentEvents[K]) => void): void
  off<K extends keyof DocumentEvents>(event: K, fn: (arg: DocumentEvents[K]) => void): void
  release(): void
}

export interface WatchHandle {
  readonly value: Record<string, unknown>
  on<K extends keyof WatchEvents>(event: K, fn: (arg: WatchEvents[K]) => void): void
  off<K extends keyof WatchEvents>(event: K, fn: (arg: WatchEvents[K]) => void): void
  release(): void
}

export function createClient(options: ClientOptions): Client {
  return new QuorumClient(options)
}

const PING_INTERVAL = 25_000
const SILENCE_TIMEOUT = 60_000
const BACKOFF_START = 200
const BACKOFF_CAP = 10_000
const SOCKET_OPEN = 1

type Fn<A> = (arg: A) => void

class Emitter<E extends object> {
  private listeners = new Map<keyof E, Set<Fn<never>>>()

  on<K extends keyof E>(event: K, fn: Fn<E[K]>): void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(fn)
  }

  off<K extends keyof E>(event: K, fn: Fn<E[K]>): void {
    this.listeners.get(event)?.delete(fn)
  }

  emit<K extends keyof E>(event: K, arg: E[K]): void {
    for (const fn of [...this.listeners.get(event) ?? []]) {
      try {
        (fn as Fn<E[K]>)(arg)
      } catch (error) {
        // An app's listener failing must not leave a document half updated
        queueMicrotask(() => {
          throw error
        })
      }
    }
  }
}

interface LocalUpdate {
  update: Uint8Array
  claim?: ActorClaim
  /** Set once sent in the current opening */
  seq?: number
}

interface PendingRecord {
  kind: string
  data: unknown
  claim?: ActorClaim
  seq?: number
}

interface Waiter<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
}

type Phase = 'idle' | 'opening' | 'open' | 'closed'

interface Opening {
  key: string
  namespace: string
  id: string
  ref: number
  phase: Phase
  /** Counted against the connection's limit */
  counted: boolean
  everOpened: boolean
  graceTimer?: ReturnType<typeof setTimeout>
}

interface DocState extends Opening {
  kind: 'doc'
  doc: Y.Doc
  content: Y.Node
  awareness: Awareness
  detach: () => void
  type: string
  incarnation: string
  capabilities: Capabilities
  records: DocumentRecord[]
  seq: number
  /** Local changes not yet acknowledged */
  local: LocalUpdate[]
  pendingRecords: PendingRecord[]
  /** Whether this Y.Doc has ever made a change of its own */
  changed: boolean
  rebuilding: boolean
  closeWhenSaved: boolean
  mode?: { mode: 'reading' | 'editing', visible: boolean }
  claims: WeakMap<object, ActorClaim>
  handles: Set<Handle>
  waiters: Waiter<void>[]
}

interface WatchState extends Opening {
  kind: 'watch'
  paths: string[]
  value: Record<string, unknown>
  handles: Set<Watch>
  waiters: Waiter<void>[]
}

interface Call {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  send: () => void
  sent: boolean
}

class QuorumClient implements Client {
  readonly ready: Promise<Welcome>
  principal: Principal | undefined
  status: Status = 'connecting'

  /** The origin of everything that came from the server, so it is not sent back */
  private readonly remote = {}
  private readonly events = new Emitter<ClientEvents>()
  private readonly options: ClientOptions
  private readonly grace: number
  private token: ClientOptions['token']
  private ws: WebSocket | undefined
  private welcomed = false
  private limits: Limits | undefined
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined
  private lastReceived = 0
  private nextRef = 1
  private nextCall = 1
  private readonly docs = new Map<string, DocState>()
  private readonly watches = new Map<string, WatchState>()
  private readonly refs = new Map<number, DocState | WatchState>()
  private readonly presences = new Map<string, Set<Fn<PresenceEntry[]>>>()
  private readonly calls = new Map<number, Call>()
  private settleReady: Waiter<Welcome> | undefined

  constructor(options: ClientOptions) {
    this.options = options
    this.grace = options.grace ?? 2000
    this.token = options.token
    this.ready = new Promise<Welcome>((resolve, reject) => {
      this.settleReady = { resolve, reject }
    })
    // Whoever awaits `ready` sees a refusal; nobody awaiting it is not an error
    this.ready.catch(() => undefined)
    this.connect()
  }

  on<K extends keyof ClientEvents>(event: K, fn: Fn<ClientEvents[K]>): void {
    this.events.on(event, fn)
  }

  off<K extends keyof ClientEvents>(event: K, fn: Fn<ClientEvents[K]>): void {
    this.events.off(event, fn)
  }

  open(namespace: string, id: string): Promise<DocumentHandle> {
    if (this.status === 'closed') {
      return Promise.reject(new QuorumError('unavailable', 'y-quorum: the client is closed'))
    }
    const key = keyOf(namespace, id)
    const existing = this.docs.get(key)
    const state = existing ?? this.createDoc(key, namespace, id)
    this.keep(state)
    const handle = new Handle(this, state)
    state.handles.add(handle)
    const opened = new Promise<DocumentHandle>((resolve, reject) => {
      if (state.everOpened) {
        resolve(handle)
      } else {
        state.waiters.push({ resolve: () => resolve(handle), reject })
      }
    })
    if (!existing) {
      this.docs.set(key, state)
      this.sendOpen(state)
    }
    return opened
  }

  watch(namespace: string, id: string, paths: string[]): Promise<WatchHandle> {
    if (this.status === 'closed') {
      return Promise.reject(new QuorumError('unavailable', 'y-quorum: the client is closed'))
    }
    const key = `${keyOf(namespace, id)}\u0000${paths.join('\u0001')}`
    const existing = this.watches.get(key)
    const state: WatchState = existing ?? {
      kind: 'watch',
      key,
      namespace,
      id,
      paths: [...paths],
      ref: 0,
      phase: 'idle',
      counted: false,
      everOpened: false,
      value: {},
      handles: new Set(),
      waiters: []
    }
    this.keep(state)
    const handle = new Watch(this, state)
    state.handles.add(handle)
    const opened = new Promise<WatchHandle>((resolve, reject) => {
      if (state.everOpened) {
        resolve(handle)
      } else {
        state.waiters.push({ resolve: () => resolve(handle), reject })
      }
    })
    if (!existing) {
      this.watches.set(key, state)
      this.sendOpen(state)
    }
    return opened
  }

  presence(namespace: string, listener: Fn<PresenceEntry[]>): () => void {
    let listeners = this.presences.get(namespace)
    if (!listeners) {
      listeners = new Set()
      this.presences.set(namespace, listeners)
      this.send(encodeFrame(ToServer.PRESENCE, { namespace, follow: true }))
    }
    listeners.add(listener)
    return () => {
      const current = this.presences.get(namespace)
      if (!current?.delete(listener) || current.size) {
        return
      }
      this.presences.delete(namespace)
      this.send(encodeFrame(ToServer.PRESENCE, { namespace, follow: false }))
    }
  }

  rpc(name: string, args?: unknown): Promise<unknown> {
    const call = this.nextCall++
    return this.call(call, () => {
      this.send(encodeFrame(ToServer.RPC, { call, name, args }))
    })
  }

  setToken(token: string): void {
    this.token = token
    this.send(encodeFrame(ToServer.TOKEN, { token }))
  }

  close(): void {
    if (this.status === 'closed') {
      return
    }
    this.shutdown({ code: 'unavailable', reason: 'y-quorum: the client was closed' })
    const ws = this.ws
    this.ws = undefined
    this.welcomed = false
    ws?.close(1000)
  }

  // Documents, for handles

  release(state: DocState | WatchState): void {
    if (state.handles.size || state.phase === 'closed') {
      return
    }
    state.graceTimer = setTimeout(() => {
      state.graceTimer = undefined
      if (state.kind === 'doc' && state.local.length && this.status !== 'closed') {
        // Closing now would lose changes on their way: close once they are stored
        state.closeWhenSaved = true
      } else {
        this.closeOpening(state)
      }
    }, this.grace)
  }

  sendUpdate(state: DocState, update: Uint8Array, claim?: ActorClaim): void {
    const seq = ++state.seq
    state.local.push({ update, claim, seq })
    const header = { ref: state.ref, layer: 'content', seq, ...(claim ? { claim } : {}) }
    this.send(encodeFrame(ToServer.UPDATE, header, update))
  }

  appendRecord(state: DocState, record: PendingRecord): void {
    if (state.phase === 'closed') {
      return
    }
    state.pendingRecords.push(record)
    if (this.isOpen(state)) {
      this.sendRecord(state, record)
    }
  }

  setMode(state: DocState, mode: 'reading' | 'editing', visible: boolean): void {
    state.mode = { mode, visible }
    if (this.isOpen(state)) {
      this.send(encodeFrame(ToServer.MODE, { ref: state.ref, mode, visible }))
    }
  }

  save(state: DocState, label?: string): Promise<number> {
    if (state.phase === 'closed') {
      return Promise.reject(new QuorumError('gone', 'y-quorum: the document is closed'))
    }
    const call = this.nextCall++
    return this.call(call, () => {
      const header = { ref: state.ref, call, ...(label !== undefined ? { label } : {}) }
      this.send(encodeFrame(ToServer.SAVE, header, Y.encodeStateVector(state.doc)))
    }).then((log) => Number(log))
  }

  // The connection

  private connect(): void {
    if (this.status === 'closed') {
      return
    }
    this.setStatus('connecting')
    const Socket = this.options.WebSocket ?? globalThis.WebSocket
    const ws = new Socket(this.options.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      void this.hello(ws)
    }
    ws.onmessage = (event: MessageEvent) => {
      if (ws !== this.ws) {
        return
      }
      this.lastReceived = Date.now()
      const data: unknown = event.data
      if (data instanceof ArrayBuffer) {
        this.receive(new Uint8Array(data))
      } else if (ArrayBuffer.isView(data)) {
        this.receive(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      }
    }
    ws.onclose = (event: CloseEvent) => {
      if (ws === this.ws) {
        this.disconnected(event.code)
      }
    }
  }

  private async hello(ws: WebSocket): Promise<void> {
    let token: string
    try {
      token = typeof this.token === 'function' ? await this.token() : this.token
    } catch {
      // No token now: try again later, as for any other failed connection
      ws.close()
      return
    }
    if (ws !== this.ws || ws.readyState !== SOCKET_OPEN) {
      return
    }
    ws.send(encodeFrame(ToServer.HELLO, { protocol: PROTOCOL_VERSION, token }))
    this.lastReceived = Date.now()
    clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => this.keepAlive(ws), PING_INTERVAL)
  }

  private keepAlive(ws: WebSocket): void {
    if (ws !== this.ws) {
      return
    }
    if (Date.now() - this.lastReceived > SILENCE_TIMEOUT) {
      // A dead connection can take minutes to report its close: give up on it now
      this.ws = undefined
      ws.close()
      this.disconnected(1006)
      return
    }
    if (ws.readyState === SOCKET_OPEN) {
      ws.send(encodeFrame(ToServer.PING, {}))
    }
  }

  private disconnected(code: number): void {
    this.ws = undefined
    this.welcomed = false
    clearInterval(this.pingTimer)
    this.pingTimer = undefined
    this.refs.clear()
    for (const state of [...this.docs.values(), ...this.watches.values()]) {
      state.phase = 'idle'
      if (state.kind === 'doc') {
        // Others' carets are unknown until the documents are open again
        const others = [...state.awareness.getStates().keys()]
          .filter((client) => client !== state.awareness.clientID)
        removeAwarenessStates(state.awareness, others, this.remote)
      }
    }
    for (const [call, entry] of this.calls) {
      if (entry.sent) {
        // It may or may not have been carried out: only the app can tell whether to retry
        this.calls.delete(call)
        entry.reject(new QuorumError('unavailable', 'y-quorum: the connection was lost'))
      }
    }
    if (this.status === 'closed') {
      return
    }
    if (code >= 4400 && code <= 4499) {
      const reason = `y-quorum: closed by the server (${code})`
      this.shutdown({ code: reasonOfClose(code), reason })
      return
    }
    this.setStatus('disconnected')
    const delay = Math.min(BACKOFF_CAP, BACKOFF_START * 2 ** this.attempts++)
    this.reconnectTimer = setTimeout(() => this.connect(), delay / 2 + Math.random() * delay / 2)
  }

  /** Closes the client for good: no reconnecting */
  private shutdown(refusal: Refusal): void {
    this.setStatus('closed')
    clearTimeout(this.reconnectTimer)
    clearInterval(this.pingTimer)
    this.settleReady?.reject(new QuorumError(refusal.code, refusal.reason))
    this.settleReady = undefined
    for (const state of [...this.docs.values(), ...this.watches.values()]) {
      clearTimeout(state.graceTimer)
      if (this.welcomed && state.kind === 'doc') {
        this.removeLocalAwareness(state)
      }
      this.drop(state, refusal)
    }
    for (const entry of this.calls.values()) {
      entry.reject(new QuorumError(refusal.code, refusal.reason))
    }
    this.calls.clear()
  }

  private setStatus(status: Status): void {
    if (this.status !== status) {
      this.status = status
      this.events.emit('status', status)
    }
  }

  private send(frame: Uint8Array): void {
    // Before WELCOME the server takes nothing but HELLO; what is not sent now
    // is sent again when the connection is back
    if (this.welcomed && this.ws?.readyState === SOCKET_OPEN) {
      this.ws.send(frame)
    }
  }

  private call(call: number, send: () => void): Promise<unknown> {
    if (this.status === 'closed') {
      return Promise.reject(new QuorumError('unavailable', 'y-quorum: the client is closed'))
    }
    return new Promise((resolve, reject) => {
      const entry: Call = { resolve, reject, send, sent: false }
      this.calls.set(call, entry)
      if (this.welcomed) {
        entry.sent = true
        send()
      }
    })
  }

  // Frames from the server

  private receive(data: Uint8Array): void {
    const frame = decodeFrame(data)
    if (!frame) {
      return
    }
    if (isFrame(frame, ToClient.WELCOME)) {
      this.welcome(frame.header)
    } else if (isFrame(frame, ToClient.REFUSED)) {
      this.events.emit('refused', frame.header)
      this.settleReady?.reject(new QuorumError(frame.header.code, frame.header.reason))
      this.settleReady = undefined
    } else if (isFrame(frame, ToClient.RESULT)) {
      const { call, ok, value, code, reason } = frame.header
      const entry = this.calls.get(call)
      this.calls.delete(call)
      if (ok) {
        entry?.resolve(value)
      } else {
        entry?.reject(new QuorumError(code ?? 'invalid', reason ?? 'y-quorum: the call failed'))
      }
    } else if (isFrame(frame, ToClient.SAVED)) {
      this.calls.get(frame.header.call)?.resolve(frame.header.log)
      this.calls.delete(frame.header.call)
    } else if (isFrame(frame, ToClient.PRESENCE)) {
      for (const listener of [...this.presences.get(frame.header.namespace) ?? []]) {
        listener(frame.header.entries)
      }
    } else if (isFrame(frame, ToClient.PONG)) {
      // Receiving it is all that counts
    } else {
      this.receiveForRef(frame)
    }
  }

  private welcome(welcome: Welcome): void {
    this.welcomed = true
    this.attempts = 0
    this.principal = welcome.principal
    this.limits = welcome.limits
    this.settleReady?.resolve(welcome)
    this.settleReady = undefined
    for (const state of [...this.docs.values(), ...this.watches.values()]) {
      this.sendOpen(state)
    }
    for (const namespace of this.presences.keys()) {
      this.send(encodeFrame(ToServer.PRESENCE, { namespace, follow: true }))
    }
    // After the documents' OPEN frames, so a save names a document the server has open
    for (const entry of this.calls.values()) {
      if (!entry.sent) {
        entry.sent = true
        entry.send()
      }
    }
    this.setStatus('connected')
  }

  private receiveForRef(frame: Frame): void {
    const header = frame.header
    if (!('ref' in header)) {
      return
    }
    const state = this.refs.get(header.ref)
    if (!state) {
      return // an opening this client has already left
    }
    if (isFrame(frame, ToClient.CLOSED)) {
      this.closedByServer(state, frame.header)
    } else if (state.kind === 'watch') {
      if (isFrame(frame, ToClient.OPENED)) {
        this.watchOpened(state, toRecord(frame.header.projection))
      } else if (isFrame(frame, ToClient.PROJECTION)) {
        state.value = toRecord(frame.header.projection)
        emitAll(state.handles, 'change', state.value)
      }
    } else if (isFrame(frame, ToClient.OPENED)) {
      this.opened(state, frame.header, frame.payload)
    } else if (isFrame(frame, ToClient.UPDATE)) {
      Y.applyUpdate(state.doc, frame.payload, this.remote)
    } else if (isFrame(frame, ToClient.AWARENESS)) {
      applyAwarenessUpdate(state.awareness, frame.payload, this.remote)
    } else if (isFrame(frame, ToClient.ACK)) {
      this.acked(state, frame.header.seq, frame.header.log)
    } else if (isFrame(frame, ToClient.REJECTED)) {
      this.rejected(state, frame.header, frame.payload)
    } else if (isFrame(frame, ToClient.POLICY)) {
      state.capabilities = frame.header.capabilities
      emitAll(state.handles, 'capabilities', state.capabilities)
    } else if (isFrame(frame, ToClient.RECORDS)) {
      state.records.push(...frame.header.records)
      emitAll(state.handles, 'records', frame.header.records)
    } else if (isFrame(frame, ToClient.MESSAGE)) {
      emitAll(state.handles, 'message', frame.header.message)
    }
  }

  // Opening and closing

  private createDoc(key: string, namespace: string, id: string): DocState {
    const doc = new Y.Doc()
    const state: DocState = {
      kind: 'doc',
      key,
      namespace,
      id,
      ref: 0,
      phase: 'idle',
      counted: false,
      everOpened: false,
      doc,
      content: doc.get('content'),
      awareness: new Awareness(doc),
      detach: () => undefined,
      type: '',
      incarnation: '',
      capabilities: { read: false, write: false },
      records: [],
      seq: 0,
      local: [],
      pendingRecords: [],
      changed: false,
      rebuilding: false,
      closeWhenSaved: false,
      claims: new WeakMap(),
      handles: new Set(),
      waiters: []
    }
    this.listen(state)
    return state
  }

  /** Sends a document's local changes and presence from now on */
  private listen(state: DocState): void {
    const { doc, awareness } = state
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === this.remote) {
        return
      }
      state.changed = true
      const claim = typeof origin === 'object' && origin !== null
        ? state.claims.get(origin)
        : undefined
      if (this.isOpen(state)) {
        this.sendUpdate(state, update, claim)
      } else {
        // Sent with the rest of what the server lacks once the document is open
        state.local.push({ update, claim })
      }
    }
    const onAwareness = (
      { added, updated, removed }: { added: number[], updated: number[], removed: number[] },
      origin: unknown
    ) => {
      const own = [...added, ...updated, ...removed].includes(awareness.clientID)
      if (origin !== this.remote && own && this.isOpen(state)) {
        const update = encodeAwarenessUpdate(awareness, [awareness.clientID])
        this.send(encodeFrame(ToServer.AWARENESS, { ref: state.ref }, update))
      }
    }
    doc.on('update', onUpdate)
    awareness.on('update', onAwareness)
    state.detach = () => {
      doc.off('update', onUpdate)
      awareness.off('update', onAwareness)
      awareness.destroy()
    }
  }

  private isOpen(state: DocState): boolean {
    return state.phase === 'open' && this.welcomed
  }

  /** A state wanted again before its grace period ran out */
  private keep(state: DocState | WatchState): void {
    clearTimeout(state.graceTimer)
    state.graceTimer = undefined
    if (state.kind === 'doc') {
      state.closeWhenSaved = false
    }
  }

  private sendOpen(state: DocState | WatchState): void {
    if (!this.welcomed || state.phase === 'closed') {
      return
    }
    if (!state.counted) {
      const limit = state.kind === 'doc' ? this.limits?.open : this.limits?.watch
      const all: Opening[] = state.kind === 'doc'
        ? [...this.docs.values()]
        : [...this.watches.values()]
      if (limit !== undefined && all.filter((other) => other.counted).length >= limit) {
        const what = state.kind === 'doc' ? 'open' : 'watched'
        this.fail(state, new QuorumError('over-limit', `y-quorum: too many documents ${what}`))
        return
      }
      state.counted = true
    }
    const ref = this.nextRef++
    state.ref = ref
    state.phase = 'opening'
    this.refs.set(ref, state)
    const { namespace, id } = state
    if (state.kind === 'watch') {
      const header = { ref, namespace, id, mode: 'watch' as const, paths: state.paths }
      this.send(encodeFrame(ToServer.OPEN, header))
      return
    }
    state.seq = 0
    for (const entry of [...state.local, ...state.pendingRecords]) {
      entry.seq = undefined
    }
    const header = {
      ref,
      namespace,
      id,
      mode: 'open' as const,
      clientId: state.doc.clientID,
      ...(state.incarnation ? { incarnation: state.incarnation } : {})
    }
    this.send(encodeFrame(ToServer.OPEN, header, Y.encodeStateVector(state.doc)))
  }

  private opened(state: DocState, header: Headers[typeof ToClient.OPENED], missing: Uint8Array) {
    if (state.incarnation && header.incarnation !== state.incarnation) {
      // The document was wiped or reseeded since: this copy is of another one
      const updates = state.local.map((entry) => entry.update)
      this.rebuild(state, {
        code: 'gone',
        reason: 'y-quorum: the document was replaced on the server',
        updates
      }, true, updates.length > 0)
      return
    }
    if (missing.length) {
      Y.applyUpdate(state.doc, missing, this.remote)
    }
    state.type = header.type
    state.incarnation = header.incarnation
    state.capabilities = header.capabilities
    state.records = header.records ?? state.records
    state.phase = 'open'
    // Everything the server lacks, offline changes and unacknowledged ones
    // alike, in one update
    const hadUnsaved = state.local.length > 0
    state.local = []
    const serverState = header.stateVector ? fromBase64(header.stateVector) : undefined
    const diff = Y.encodeStateAsUpdate(state.doc, serverState)
    if (hasContent(diff)) {
      this.sendUpdate(state, diff)
    }
    if (state.mode) {
      this.send(encodeFrame(ToServer.MODE, { ref: state.ref, ...state.mode }))
    }
    if (state.awareness.getLocalState() !== null) {
      const update = encodeAwarenessUpdate(state.awareness, [state.awareness.clientID])
      this.send(encodeFrame(ToServer.AWARENESS, { ref: state.ref }, update))
    }
    for (const record of state.pendingRecords) {
      this.sendRecord(state, record)
    }
    state.everOpened = true
    for (const waiter of state.waiters.splice(0)) {
      waiter.resolve()
    }
    if (state.rebuilding) {
      state.rebuilding = false
      emitAll(state.handles, 'rebuilt', { doc: state.doc })
    }
    if (hadUnsaved && !state.local.length) {
      this.allSaved(state, undefined)
    }
  }

  private watchOpened(state: WatchState, value: Record<string, unknown>): void {
    state.phase = 'open'
    state.value = value
    if (state.everOpened) {
      emitAll(state.handles, 'change', value)
    }
    state.everOpened = true
    for (const waiter of state.waiters.splice(0)) {
      waiter.resolve()
    }
  }

  private sendRecord(state: DocState, record: PendingRecord): void {
    record.seq = ++state.seq
    const { kind, data, claim } = record
    const header = { ref: state.ref, seq: record.seq, kind, data, ...(claim ? { claim } : {}) }
    this.send(encodeFrame(ToServer.RECORD, header))
  }

  private acked(state: DocState, seq: number, log: number): void {
    state.pendingRecords = state.pendingRecords.filter((record) => record.seq !== seq)
    const before = state.local.length
    state.local = state.local.filter((entry) => entry.seq !== seq)
    if (before && !state.local.length) {
      this.allSaved(state, log)
    }
  }

  private allSaved(state: DocState, log: number | undefined): void {
    emitAll(state.handles, 'saved', log === undefined ? {} : { log })
    if (state.closeWhenSaved) {
      this.closeOpening(state)
    }
  }

  private rejected(
    state: DocState,
    header: Headers[typeof ToClient.REJECTED],
    refused: Uint8Array
  ): void {
    const { seq, code, reason } = header
    const record = state.pendingRecords.find((entry) => entry.seq === seq)
    if (record) {
      // A refused record leaves the document as it was: nothing to rebuild
      state.pendingRecords = state.pendingRecords.filter((entry) => entry !== record)
      const { kind, data } = record
      emitAll(state.handles, 'rejected', { code, reason, updates: [], record: { kind, data } })
      return
    }
    const later = state.local.filter((entry) => entry.seq === undefined || entry.seq >= seq)
    const updates = later.map((entry) => entry.update)
    if (!later.some((entry) => entry.seq === seq)) {
      updates.unshift(refused)
    }
    this.rebuild(state, { code, reason, updates }, true, true)
  }

  /**
   * Starts the document again from the server's state under a new client id:
   * after a refusal every later change of the old one depends on what the
   * server will never have, so none of them could be stored.
   */
  private rebuild(state: DocState, rejection: Rejection, close: boolean, announce: boolean): void {
    const old = state.doc
    const presence = state.awareness.getLocalState()
    if (close && this.refs.has(state.ref)) {
      this.removeLocalAwareness(state)
      this.send(encodeFrame(ToServer.CLOSE, { ref: state.ref }))
    }
    this.refs.delete(state.ref)
    state.detach()
    const doc = new Y.Doc()
    while (doc.clientID === old.clientID) {
      doc.clientID = newClientId()
    }
    state.doc = doc
    state.content = doc.get('content')
    state.awareness = new Awareness(doc)
    state.awareness.setLocalState(presence)
    this.listen(state)
    state.phase = 'idle'
    state.local = []
    state.incarnation = ''
    state.changed = false
    state.rebuilding = true
    if (announce) {
      emitAll(state.handles, 'rejected', rejection)
    }
    this.sendOpen(state)
  }

  private closedByServer(state: DocState | WatchState, refusal: Refusal): void {
    this.refs.delete(state.ref)
    state.phase = 'idle'
    if (state.kind === 'doc' && refusal.code === 'client-id-taken') {
      if (!state.changed) {
        // Nothing was written under the id yet: take another and carry on
        const presence = state.awareness.getLocalState()
        state.awareness.setLocalState(null)
        while (state.doc.clientID === state.awareness.clientID) {
          state.doc.clientID = newClientId()
        }
        state.awareness.clientID = state.doc.clientID
        state.awareness.setLocalState(presence)
        this.sendOpen(state)
      } else {
        const updates = state.local.map((entry) => entry.update)
        this.rebuild(state, { ...refusal, updates }, false, true)
      }
      return
    }
    this.fail(state, new QuorumError(refusal.code, refusal.reason))
  }

  /** Ends an opening: waiters are refused, handles told */
  private fail(state: DocState | WatchState, error: QuorumError): void {
    for (const waiter of state.waiters.splice(0)) {
      waiter.reject(error)
    }
    this.drop(state, { code: error.code, reason: error.message })
  }

  private drop(state: DocState | WatchState, refusal: Refusal): void {
    const live = state.phase !== 'closed'
    state.phase = 'closed'
    this.refs.delete(state.ref)
    if (state.kind === 'doc') {
      if (this.docs.get(state.key) === state) {
        this.docs.delete(state.key)
      }
      for (const waiter of state.waiters.splice(0)) {
        waiter.reject(new QuorumError(refusal.code, refusal.reason))
      }
      if (live) {
        state.detach()
        emitAll(state.handles, 'closed', refusal)
      }
    } else {
      if (this.watches.get(state.key) === state) {
        this.watches.delete(state.key)
      }
      for (const waiter of state.waiters.splice(0)) {
        waiter.reject(new QuorumError(refusal.code, refusal.reason))
      }
      if (live) {
        emitAll(state.handles, 'closed', refusal)
      }
    }
  }

  /** Closes an opening nobody holds any more */
  private closeOpening(state: DocState | WatchState): void {
    if (state.handles.size || state.phase === 'closed') {
      return
    }
    if (this.refs.has(state.ref)) {
      if (state.kind === 'doc') {
        this.removeLocalAwareness(state)
      }
      this.send(encodeFrame(ToServer.CLOSE, { ref: state.ref }))
    }
    this.drop(state, { code: 'gone', reason: 'y-quorum: released' })
  }

  /** Tells the others this client's caret is gone */
  private removeLocalAwareness(state: DocState): void {
    const { awareness } = state
    if (awareness.getLocalState() !== null) {
      removeAwarenessStates(awareness, [awareness.clientID], 'local')
    }
  }
}

/** What every handle has: listeners, to which the client delivers events */
class Listeners<E extends object> {
  readonly events = new Emitter<E>()

  on<K extends keyof E>(event: K, fn: Fn<E[K]>): void {
    this.events.on(event, fn)
  }

  off<K extends keyof E>(event: K, fn: Fn<E[K]>): void {
    this.events.off(event, fn)
  }
}

class Handle extends Listeners<DocumentEvents> implements DocumentHandle {
  private released = false

  constructor(private readonly client: QuorumClient, private readonly state: DocState) {
    super()
  }

  get namespace() { return this.state.namespace }
  get id() { return this.state.id }
  get type() { return this.state.type }
  get incarnation() { return this.state.incarnation }
  get doc() { return this.state.doc }
  get content() { return this.state.content }
  get awareness() { return this.state.awareness }
  get capabilities() { return this.state.capabilities }
  get records() { return this.state.records }
  get hasUnsavedChanges() { return this.state.local.length > 0 }

  claimOrigin(claim: ActorClaim): object {
    const origin = { claim }
    this.state.claims.set(origin, claim)
    return origin
  }

  appendRecord(kind: string, data: unknown, claim?: ActorClaim): void {
    if (!this.released) {
      this.client.appendRecord(this.state, { kind, data, ...(claim ? { claim } : {}) })
    }
  }

  setMode(mode: 'reading' | 'editing', visible = true): void {
    if (!this.released) {
      this.client.setMode(this.state, mode, visible)
    }
  }

  save(label?: string): Promise<number> {
    return this.client.save(this.state, label)
  }

  release(): void {
    if (this.released) {
      return
    }
    this.released = true
    this.state.handles.delete(this)
    this.client.release(this.state)
  }
}

class Watch extends Listeners<WatchEvents> implements WatchHandle {
  private released = false

  constructor(private readonly client: QuorumClient, private readonly state: WatchState) {
    super()
  }

  get value() { return this.state.value }

  release(): void {
    if (this.released) {
      return
    }
    this.released = true
    this.state.handles.delete(this)
    this.client.release(this.state)
  }
}

/** Events of a document or watch reach every handle still held */
function emitAll<E extends object, K extends keyof E>(
  handles: Set<Listeners<E>>,
  event: K,
  arg: E[K]
): void {
  for (const handle of [...handles]) {
    handle.events.emit(event, arg)
  }
}

function keyOf(namespace: string, id: string): string {
  return `${namespace}\u0000${id}`
}

function newClientId(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
}

function hasContent(update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update)
  return structs.length > 0 || !ds.isEmpty()
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function reasonOfClose(code: number): ReasonCode {
  if (code === 4401) {
    return 'unauthenticated'
  }
  if (code === 4426) {
    return 'stale-protocol'
  }
  return 'not-allowed'
}
