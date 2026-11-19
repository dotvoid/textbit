// One document, held by its owner: the only place its writes are judged,
// applied, logged and passed on. Writes are handled one at a time, in order.
//
// The write pipeline:
//   1. new content must come from a Y.js client id the writer has claimed;
//   2. the update is applied to a shadow copy first, which says what it
//      changes, as paths, and whether it can be integrated at all;
//   3. the policy decides on those paths;
//   4. accepted: appended to the log, applied, acknowledged, passed on, and
//      every connection's capabilities asked again; refused: the shadow is
//      rebuilt from the document and the writer told, with the update, so its
//      app can keep what was written.
import * as Y from '@y/y'
import * as awarenessProtocol from '@y/protocols/awareness'
import {
  ToClient,
  ToServer,
  encodeFrame,
  type ActorClaim,
  type Capabilities,
  type DocumentRecord,
  type Headers,
  type Principal,
  type ReasonCode
} from '@dotvoid/y-quorum-client/protocol'
import { pathOf, projection, resolvePath, toJSON, type Path } from '@dotvoid/y-quorum-client/model'
import type { Actor, LogEntry, ServerOptions, ServerType, Storage, StoredDocument } from './types'

/** A connection, as a document sees it */
export interface Peer {
  principal: Principal
  /** Whether agents may claim to act for this principal through it */
  agents: boolean
  send(frame: Uint8Array): void
}

/** One connection's opening of the document */
export interface Opening {
  peer: Peer
  ref: number
  mode: 'open' | 'watch'
  paths: string[]
  roles: string[]
  capabilities: Capabilities
  /** The awareness clients this opening speaks for */
  awarenessClients: Set<number>
  /** The projection last sent, as JSON, for watching */
  sent?: string
  presence: { mode: 'watching' | 'reading' | 'editing', visible: boolean }
}

const CONTENT = 'content'

export class DocumentOwner {
  readonly openings = new Set<Opening>()
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  readonly records: DocumentRecord[]
  readonly incarnation: string
  private shadow: Y.Doc
  private seq: number
  private recordSeq: number
  private sinceCheckpoint = 0
  private queue: Promise<unknown> = Promise.resolve()
  private projecting: ReturnType<typeof setTimeout> | undefined
  private saves: Array<{ opening: Opening, call: number, vector: Map<number, number>, actor: Actor, label?: string }> = []

  constructor(
    readonly namespace: string,
    readonly id: string,
    readonly type: ServerType,
    stored: StoredDocument,
    private readonly storage: Storage,
    private readonly options: ServerOptions,
    private readonly changed: (owner: DocumentOwner) => void
  ) {
    this.doc = new Y.Doc()
    if (stored.checkpoint) {
      Y.applyUpdate(this.doc, stored.checkpoint.state)
    }
    for (const entry of stored.entries) {
      Y.applyUpdate(this.doc, entry.update)
    }
    this.seq = stored.entries.length ? stored.entries[stored.entries.length - 1].seq : stored.checkpoint?.seq ?? 0
    this.records = stored.records
    this.recordSeq = stored.records.length ? stored.records[stored.records.length - 1].seq : 0
    this.incarnation = stored.meta.incarnation
    this.shadow = this.copy()
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null)
    this.awareness.on('update', this.relayAwareness)
  }

  get root(): Y.Node {
    return this.doc.get(CONTENT)
  }

  /** The content as JSON */
  json(): Record<string, unknown> {
    return toJSON(this.root, this.type.content)
  }

  get isIdle(): boolean {
    return this.openings.size === 0
  }

  /** Runs tasks of this document one at a time, in order */
  private serial<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private copy(): Y.Doc {
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(this.doc))
    return copy
  }

  capabilitiesFor(principal: Principal, roles: string[]): Capabilities {
    if (this.type.policy) {
      return this.type.policy({ actor: { principal }, roles, layer: CONTENT, content: this.root })
    }
    const write = roles.some((role) => role === 'editor' || role === 'owner')
    return { read: roles.length > 0, write, records: write ? Object.keys(this.type.records ?? {}) : [] }
  }

  // ---- Opening and closing ------------------------------------------------

  async open(opening: Opening, header: Headers[typeof ToServer.OPEN], vector: Uint8Array): Promise<void> {
    return this.serial(async () => {
      if (opening.mode === 'open' && header.clientId !== undefined) {
        const own = await this.storage.claimClient(this.namespace, this.id, header.clientId, opening.peer.principal.id)
        if (!own) {
          this.sendTo(opening, ToClient.CLOSED, { ref: opening.ref, code: 'client-id-taken', reason: 'That client id writes for someone else; pick another' })
          return
        }
      }
      this.openings.add(opening)
      if (opening.mode === 'watch') {
        const value = projection(this.root, this.type.content, opening.paths)
        opening.sent = JSON.stringify(value)
        this.sendTo(opening, ToClient.OPENED, {
          ref: opening.ref, type: this.type.name, incarnation: this.incarnation,
          capabilities: opening.capabilities, seq: this.seq, projection: value
        })
      } else {
        const known = header.incarnation === undefined || header.incarnation === this.incarnation
        const missing = Y.encodeStateAsUpdate(this.doc, known && vector.length ? vector : undefined)
        this.sendTo(opening, ToClient.OPENED, {
          ref: opening.ref, type: this.type.name, incarnation: this.incarnation,
          capabilities: opening.capabilities, seq: this.seq,
          stateVector: Buffer.from(Y.encodeStateVector(this.doc)).toString('base64'),
          records: this.records
        }, missing)
        const present = [...this.awareness.getStates().keys()]
        if (present.length) {
          this.sendTo(opening, ToClient.AWARENESS, { ref: opening.ref }, awarenessProtocol.encodeAwarenessUpdate(this.awareness, present))
        }
      }
      this.changed(this)
    })
  }

  close(opening: Opening): void {
    if (!this.openings.delete(opening)) {
      return
    }
    if (opening.awarenessClients.size) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...opening.awarenessClients], null)
    }
    this.changed(this)
  }

  // ---- Writes ---------------------------------------------------------------

  update(opening: Opening, header: Headers[typeof ToServer.UPDATE], update: Uint8Array): Promise<void> {
    return this.serial(async () => {
      const actor = this.actorOf(opening, header.claim)
      const refusal = actor ? await this.judge(opening.peer.principal.id, actor, opening.roles, update) : { code: 'not-allowed' as const, reason: 'Agents may not act for this principal' }
      if (refusal) {
        this.sendTo(opening, ToClient.REJECTED, { ref: opening.ref, seq: header.seq, code: refusal.code, reason: refusal.reason }, update)
        return
      }
      const log = await this.commit(actor!, header.layer, update, opening)
      this.sendTo(opening, ToClient.ACK, { ref: opening.ref, seq: header.seq, log })
    })
  }

  /** Changes the document from this process, as an actor, through the same rules */
  transact(actor: Actor, roles: string[], change: (content: Y.Node) => void): Promise<boolean> {
    return this.serial(async () => {
      const copy = this.copy()
      const before = Y.encodeStateVector(copy)
      copy.transact(() => change(copy.get(CONTENT)))
      const update = Y.encodeStateAsUpdate(copy, before)
      // A client id of its own, claimed for the actor, as any writer's
      if (!(await this.storage.claimClient(this.namespace, this.id, copy.clientID, actor.principal.id))) {
        return false
      }
      const refusal = await this.judge(actor.principal.id, actor, roles, update)
      if (refusal) {
        return false
      }
      await this.commit(actor, CONTENT, update)
      return true
    })
  }

  // Whether a write may be applied: nothing when it may, the reason when not
  private async judge(principalId: string, actor: Actor, roles: string[], update: Uint8Array): Promise<{ code: ReasonCode, reason: string } | undefined> {
    // 1. New content only under the writer's own client ids
    const known = Y.decodeStateVector(Y.encodeStateVector(this.doc))
    const clients = new Set<number>()
    for (const struct of Y.decodeUpdate(update).structs) {
      const { client, clock } = struct.id
      if (clock + struct.length > (known.get(client) ?? 0)) {
        clients.add(client)
      }
    }
    for (const client of clients) {
      if (!(await this.storage.claimClient(this.namespace, this.id, client, principalId))) {
        return { code: 'not-allowed', reason: 'The update writes under a client id held by someone else' }
      }
    }
    // 2. On the shadow first: what it changes, and whether it fits at all
    let changed: Map<Y.Node, Set<string | null>> | undefined
    const capture = (transaction: { changed: Map<Y.Node, Set<string | null>> }) => {
      changed = transaction.changed
    }
    this.shadow.on('afterTransaction', capture)
    try {
      Y.applyUpdate(this.shadow, update)
    } finally {
      this.shadow.off('afterTransaction', capture)
    }
    if ((this.shadow as unknown as { store: { pendingStructs: unknown } }).store.pendingStructs) {
      this.shadow = this.copy()
      return { code: 'conflict', reason: 'The update depends on changes the server does not have' }
    }
    // 3. The policy, on the paths it changes
    const paths = this.pathsOf(changed)
    const allowed = this.type.policy
      ? this.type.policy({ actor, roles, layer: CONTENT, content: this.root, next: this.shadow.get(CONTENT), paths }).write
      : roles.some((role) => role === 'editor' || role === 'owner')
    if (!allowed) {
      this.shadow = this.copy()
      return { code: 'not-allowed', reason: paths.length ? `Not allowed to change ${paths.map((p) => p.join('.')).join(', ')}` : 'Not allowed to write here' }
    }
    return undefined
  }

  private pathsOf(changed: Map<Y.Node, Set<string | null>> | undefined): Path[] {
    const root = this.shadow.get(CONTENT)
    const found = new Map<string, Path>()
    for (const [node, keys] of changed ?? []) {
      const base = node === root ? [] : pathOf(node, root, this.type.content)
      if (!base) {
        continue
      }
      const at = resolvePath(root, this.type.content, base)
      for (const key of keys) {
        const path = key !== null && at?.field.kind === 'object' ? [...base, key] : base
        found.set(path.join('\u0000'), path)
      }
    }
    return [...found.values()]
  }

  // Accepted: logged, applied, passed on
  private async commit(actor: Actor, layer: string, update: Uint8Array, from?: Opening): Promise<number> {
    const entry: LogEntry = { seq: this.seq + 1, at: Date.now(), layer, actor, update }
    await this.storage.append(this.namespace, this.id, [entry])
    this.seq = entry.seq
    Y.applyUpdate(this.doc, update, from ?? this)
    for (const opening of this.openings) {
      if (opening !== from && opening.mode === 'open') {
        this.sendTo(opening, ToClient.UPDATE, { ref: opening.ref, layer }, update)
      }
    }
    this.afterChange()
    if (++this.sinceCheckpoint >= (this.options.checkpointEvery ?? 200)) {
      await this.checkpoint()
    }
    this.settleSaves()
    return this.seq
  }

  private afterChange() {
    // What everyone may do, asked again: content decides it too
    for (const opening of this.openings) {
      const capabilities = this.capabilitiesFor(opening.peer.principal, opening.roles)
      if (JSON.stringify(capabilities) !== JSON.stringify(opening.capabilities)) {
        opening.capabilities = capabilities
        this.sendTo(opening, ToClient.POLICY, { ref: opening.ref, seq: this.seq, capabilities })
      }
    }
    // Watchers, a moment later and only what changed
    clearTimeout(this.projecting)
    this.projecting = setTimeout(() => {
      for (const opening of this.openings) {
        if (opening.mode !== 'watch') {
          continue
        }
        const value = projection(this.root, this.type.content, opening.paths)
        const json = JSON.stringify(value)
        if (json !== opening.sent) {
          opening.sent = json
          this.sendTo(opening, ToClient.PROJECTION, { ref: opening.ref, projection: value })
        }
      }
    }, 100)
  }

  async checkpoint(): Promise<void> {
    this.sinceCheckpoint = 0
    await this.storage.checkpoint(this.namespace, this.id, Y.encodeStateAsUpdate(this.doc), this.seq)
  }

  // Who an update is from: the connection's principal, or an agent claiming to act for it
  private actorOf(opening: Opening, claim: ActorClaim | undefined): Actor | undefined {
    const principal = opening.peer.principal
    if (!claim) {
      return { principal }
    }
    if (!opening.peer.agents) {
      return undefined
    }
    return {
      principal: { kind: 'agent', id: claim.agent, name: claim.name ?? claim.agent },
      onBehalfOf: principal,
      ...(claim.run ? { run: claim.run } : {}),
      ...(claim.model ? { model: claim.model } : {})
    }
  }

  // ---- Presence, records, saves, messages -----------------------------------

  awarenessFrom(opening: Opening, update: Uint8Array): void {
    // Everyone appears as who the server knows them to be
    const principal = opening.peer.principal
    const stamped = awarenessProtocol.modifyAwarenessUpdate(update, (state: Record<string, unknown> | null) =>
      state === null ? state : { ...state, principal: { kind: principal.kind, id: principal.id, name: principal.name } })
    awarenessProtocol.applyAwarenessUpdate(this.awareness, stamped, opening)
  }

  private relayAwareness = ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: unknown) => {
    const from = origin as Opening | null
    if (from && this.openings.has(from)) {
      added.forEach((client) => from.awarenessClients.add(client))
      removed.forEach((client) => from.awarenessClients.delete(client))
    }
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed])
    for (const opening of this.openings) {
      if (opening !== from && opening.mode === 'open') {
        this.sendTo(opening, ToClient.AWARENESS, { ref: opening.ref }, update)
      }
    }
  }

  record(opening: Opening, header: Headers[typeof ToServer.RECORD]): Promise<void> {
    return this.serial(async () => {
      const actor = this.actorOf(opening, header.claim)
      if (!actor || !(opening.capabilities.records ?? []).includes(header.kind) || !this.type.records?.[header.kind]) {
        this.sendTo(opening, ToClient.REJECTED, { ref: opening.ref, seq: header.seq, code: 'not-allowed', reason: `Not allowed to record ${header.kind}` })
        return
      }
      await this.appendRecord(actor, header.kind, header.data)
      // Acknowledged like a change, so the client does not send it again
      this.sendTo(opening, ToClient.ACK, { ref: opening.ref, seq: header.seq, log: this.seq })
    })
  }

  async appendRecord(actor: Actor, kind: string, data: unknown): Promise<DocumentRecord> {
    const record: DocumentRecord = {
      seq: ++this.recordSeq,
      kind,
      at: Date.now(),
      actor: actor.principal,
      ...(actor.onBehalfOf ? { onBehalfOf: actor.onBehalfOf } : {}),
      data
    }
    await this.storage.appendRecord(this.namespace, this.id, record)
    this.records.push(record)
    for (const opening of this.openings) {
      if (opening.mode === 'open') {
        this.sendTo(opening, ToClient.RECORDS, { ref: opening.ref, records: [record] })
      }
    }
    return record
  }

  /** A save: answered once the document holds everything the client had */
  save(opening: Opening, header: Headers[typeof ToServer.SAVE], vector: Uint8Array): void {
    this.saves.push({ opening, call: header.call, vector: Y.decodeStateVector(vector), actor: { principal: opening.peer.principal }, ...(header.label ? { label: header.label } : {}) })
    void this.serial(() => this.settleSaves())
  }

  private settleSaves() {
    const have = Y.decodeStateVector(Y.encodeStateVector(this.doc))
    const waiting = this.saves
    this.saves = []
    for (const save of waiting) {
      const complete = [...save.vector].every(([client, clock]) => (have.get(client) ?? 0) >= clock)
      if (!complete) {
        this.saves.push(save)
        continue
      }
      void Promise.resolve(this.options.onSave?.({
        namespace: this.namespace, id: this.id, seq: this.seq, actor: save.actor, json: this.json(),
        ...(save.label ? { label: save.label } : {})
      })).then(() => {
        this.sendTo(save.opening, ToClient.SAVED, { ref: save.opening.ref, call: save.call, log: this.seq })
      })
    }
  }

  setMode(opening: Opening, mode: 'reading' | 'editing', visible: boolean): void {
    opening.presence = { mode, visible }
    this.changed(this)
  }

  message(message: unknown): void {
    for (const opening of this.openings) {
      this.sendTo(opening, ToClient.MESSAGE, { ref: opening.ref, message })
    }
  }

  /** Ends every opening, e.g. when the document is deleted */
  closeAll(code: ReasonCode, reason: string): void {
    for (const opening of [...this.openings]) {
      this.sendTo(opening, ToClient.CLOSED, { ref: opening.ref, code, reason })
      this.close(opening)
    }
  }

  async unload(): Promise<void> {
    await this.serial(async () => {
      clearTimeout(this.projecting)
      await this.checkpoint()
      await this.storage.unloaded?.(this.namespace, this.id, Y.encodeStateAsUpdate(this.doc), this.json(), this.type.name)
      this.awareness.destroy()
    })
  }

  private sendTo<T extends keyof Headers>(opening: Opening, type: T, header: Headers[T], payload?: Uint8Array) {
    opening.peer.send(encodeFrame(type, header, payload))
  }
}
