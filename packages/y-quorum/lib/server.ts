// The y-quorum server: documents held by their owners, connections that each
// carry many documents, authentication, namespaces and presence.
import { createServer as createHttpServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from '@y/y'
import {
  CloseCode,
  PROTOCOL_VERSION,
  ToClient,
  ToServer,
  decodeFrame,
  encodeFrame,
  isFrame,
  type Headers,
  type Limits,
  type Principal,
  type PresenceEntry,
  type ReasonCode
} from '@dotvoid/y-quorum-client/protocol'
import {
  COMMENTS,
  actorKey,
  attributionsOf,
  createContent,
  seedComments,
  type CommentThread
} from '@dotvoid/y-quorum-client/model'
import { DocumentOwner, type Opening, type Peer } from './document'
import type { Actor, Authenticated, Lease, QuorumServer, ServerOptions, ServerType, StoredDocument } from './types'
import type { HostStore } from './storage/host'
import { toJSONLine } from './history'
import { nodeToken, openRelay, readNodeToken, type Relay } from './cluster'

const DEFAULT_LIMITS: Limits = { open: 500, watch: 2000, frame: 4 * 1024 * 1024 }

/** A connection's own state */
interface Connection extends Peer {
  socket: WebSocket
  request?: IncomingMessage
  auth?: Authenticated
  openings: Map<number, { owner: DocumentOwner, opening: Opening }>
  following: Set<string>
  alive: boolean
  /** Relays to other nodes, by their address, and which openings go through which */
  relays: Map<string, Promise<Relay>>
  remote: Map<number, Relay>
  /** Another node, by the secret the nodes share: a relay for a client, or a link */
  fromNode?: boolean
  /** Another node speaking for itself: the only one whose NODE_MESSAGE counts */
  link?: boolean
}

export function createServer(options: ServerOptions): QuorumServer {
  const types = new Map<string, ServerType>(options.types.map((type) => [type.name, type]))
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits }
  const owners = new Map<string, Promise<DocumentOwner | undefined>>()
  // Documents being stored as they go: loaded again only once that is done
  const unloads = new Map<string, Promise<void>>()
  const unloading = new Map<string, ReturnType<typeof setTimeout>>()
  const connections = new Set<Connection>()
  const presenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const keyOf = (namespace: string, id: string) => `${namespace}\u0000${id}`
  let sockets: WebSocketServer | undefined
  let http: HttpServer | undefined
  // More than one node: documents held by lease, renewed while they are here
  const node = options.node && options.storage.lease ? options.node : undefined
  if (node && !options.nodeSecret) {
    throw new Error('y-quorum: a node needs `nodeSecret`, the secret the nodes share')
  }
  const ttl = options.leaseTtl ?? 10000
  const renewals = new Map<string, ReturnType<typeof setInterval>>()
  // The epoch of a lease just taken here, for the owner loaded under it
  const taken = new Map<string, number>()

  // ---- Documents ------------------------------------------------------------

  /** The owner of a document, loading it when needed; nothing when it does not exist */
  function ownerOf(namespace: string, id: string): Promise<DocumentOwner | undefined> {
    const key = keyOf(namespace, id)
    clearTimeout(unloading.get(key))
    unloading.delete(key)
    let owner = owners.get(key)
    if (!owner) {
      owner = load(namespace, id)
      owners.set(key, owner)
      owner.then((loaded) => {
        if (!loaded) {
          owners.delete(key)
        }
      }, () => owners.delete(key))
    }
    return owner
  }

  async function load(namespace: string, id: string): Promise<DocumentOwner | undefined> {
    await unloads.get(keyOf(namespace, id))
    let stored = await options.storage.load(namespace, id)
    if (!stored) {
      stored = await seedFromHost(namespace, id)
    }
    if (!stored) {
      return undefined
    }
    const type = types.get(stored.meta.type)
    if (!type) {
      throw new Error(`y-quorum: ${namespace}/${id} is of type ${stored.meta.type}, which this server does not know`)
    }
    const owner = new DocumentOwner(namespace, id, type, stored, options.storage, options, changed)
    // Let go of, here: passed to another node, or not stored as it should
    // have been. Whoever comes back loads it afresh.
    const key = keyOf(namespace, id)
    owner.onLost = () => {
      clearInterval(renewals.get(key))
      renewals.delete(key)
      void owners.get(key)?.then((current) => {
        if (current === owner) {
          owners.delete(key)
        }
      })
    }
    if (node) {
      // Fenced from the first write, before the first renewal says the epoch
      owner.epoch = taken.get(key)
      taken.delete(key)
      hold(owner)
    }
    await owner.recover()
    return owner
  }

  // A host that keeps JSON: a document the cache lacks is made from it
  async function seedFromHost(namespace: string, id: string): Promise<StoredDocument | undefined> {
    const host = (options.storage as { seedFrom?: HostStore }).seedFrom
    const found = await host?.load(namespace, id)
    if (!found) {
      return undefined
    }
    await create(namespace, id, found.type, found.content, found.comments)
    return options.storage.load(namespace, id)
  }

  async function create(
    namespace: string,
    id: string,
    typeName: string,
    initial: Record<string, unknown> = {},
    comments: CommentThread[] = [],
    actor?: Actor
  ): Promise<void> {
    const type = types.get(typeName)
    if (!type) {
      throw new Error(`y-quorum: no type ${typeName}`)
    }
    const doc = new Y.Doc()
    createContent(doc.get('content'), type.content, initial)
    // Comments are a Y.Doc of their own beside the content
    const commentsDoc = new Y.Doc()
    if (type.comments && comments.length) {
      seedComments(commentsDoc.get(COMMENTS), comments)
    }
    const createdAt = Date.now()
    // With history, the first content is attributed to whoever made the
    // document, or to the system
    const by = actor?.principal ?? { kind: 'service' as const, id: 'system', name: 'System' }
    const history = type.history
      ? (() => {
          const ids = Y.createContentIdsFromDoc(doc, false)
          const person = { kind: by.kind, id: by.id, name: by.name }
          return {
            attributions: { content: Y.encodeContentMap(attributionsOf(ids.inserts, ids.deletes, { by: person, at: createdAt })) },
            people: { [actorKey(person)]: person }
          }
        })()
      : {}
    await options.storage.create(namespace, id, { type: typeName, incarnation: randomUUID(), createdAt }, {
      states: {
        content: Y.encodeStateAsUpdate(doc),
        comments: Y.encodeStateAsUpdate(commentsDoc),
        // The suggestions start as a fork of the content
        ...(type.suggestions ? { suggestions: Y.encodeStateAsUpdate(doc) } : {})
      },
      ...history
    })
    // With history, the first version is the document as it was made: going
    // back through time starts there
    if (type.history) {
      await options.storage.addVersion(namespace, id, {
        id: randomUUID(), seq: 0, at: createdAt, kind: 'created', label: 'Created',
        by: { kind: by.kind, id: by.id, name: by.name }
      }, Y.encodeStateAsUpdate(doc))
    }
  }

  // Something changed about who has a document open: presence, and maybe unload
  function changed(owner: DocumentOwner) {
    schedulePresence(owner.namespace)
    if (owner.isIdle) {
      const key = keyOf(owner.namespace, owner.id)
      clearTimeout(unloading.get(key))
      unloading.set(key, setTimeout(() => {
        unloading.delete(key)
        if (owner.isIdle && owners.get(key)) {
          owners.delete(key)
          unloadOwner(key, owner)
        }
      }, options.idle ?? 5000))
    }
  }

  // Stores a document as it goes; whoever loads it again waits for that
  function unloadOwner(key: string, owner: DocumentOwner): Promise<void> {
    const done = owner.unload().then(() => letGo(owner), (error: unknown) => {
      console.error('y-quorum: a document failed to unload', error)
    })
    unloads.set(key, done)
    void done.then(() => {
      if (unloads.get(key) === done) {
        unloads.delete(key)
      }
    })
    return done
  }

  // ---- More than one node -------------------------------------------------

  /** Where a document is held: here, or by the lease of another node */
  async function place(namespace: string, id: string): Promise<'here' | Lease> {
    const lease = await options.storage.lease!(namespace, id, node!, ttl)
    if (lease.holder !== node!.id) {
      return lease
    }
    taken.set(keyOf(namespace, id), lease.epoch)
    return 'here'
  }

  // A document loaded here: held by its lease, renewed while it is here
  function hold(owner: DocumentOwner) {
    const key = keyOf(owner.namespace, owner.id)
    const renew = async () => {
      const lease = await options.storage.lease!(owner.namespace, owner.id, node!, ttl)
      if (lease.holder !== node!.id || (owner.epoch !== undefined && lease.epoch !== owner.epoch)) {
        // Taken again here with a new epoch: the lease ran out, or the document
        // was deleted on another node, which ends its lease
        if (lease.holder === node!.id && !(await options.storage.load(owner.namespace, owner.id))) {
          owner.closeAll('gone', 'The document was deleted')
          void options.storage.releaseLease?.(owner.namespace, owner.id, node!.id)
        }
        owner.giveUp()
        return
      }
      owner.epoch = lease.epoch
    }
    void renew().catch(() => owner.giveUp())
    clearInterval(renewals.get(key))
    const timer = setInterval(() => void renew().catch(() => undefined), Math.max(50, ttl / 3))
    timer.unref?.()
    renewals.set(key, timer)
  }

  function letGo(owner: DocumentOwner) {
    const key = keyOf(owner.namespace, owner.id)
    clearInterval(renewals.get(key))
    renewals.delete(key)
    if (node && !owner.isLost) {
      void options.storage.releaseLease?.(owner.namespace, owner.id, node.id)
    }
  }

  /**
   * Passes an opening on to the node holding the document. A node that does
   * not answer is waited for until its lease runs out, and the document then
   * taken here.
   */
  async function forward(connection: Connection, header: Headers[typeof ToServer.OPEN], vector: Uint8Array, lease: Lease) {
    let current: 'here' | Lease = lease
    while (current !== 'here') {
      const relay = await relayTo(connection, current.address).catch(() => undefined)
      if (!connections.has(connection)) {
        return // the client left meanwhile; its relays are closed as they come
      }
      if (relay) {
        connection.remote.set(header.ref, relay)
        relay.send(encodeFrame(ToServer.OPEN, header, vector))
        return
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(20, current === 'here' ? 0 : current.until - Date.now()))))
      current = await place(header.namespace, header.id)
    }
    await open(connection, header, vector)
  }

  // For code in this process: a document is worked on where it is held. With
  // more than one node, held here or taken here, else it is another node's to serve.
  async function localOwner(namespace: string, id: string): Promise<DocumentOwner | undefined> {
    if (node) {
      const where = await place(namespace, id)
      if (where !== 'here') {
        throw new Error(`y-quorum: ${namespace}/${id} is held by the node at ${where.address}; work on it there`)
      }
    }
    return ownerOf(namespace, id)
  }

  // One relay per connection and node: everything it opens there goes through it
  function relayTo(connection: Connection, address: string): Promise<Relay> {
    let relay = connection.relays.get(address)
    if (!relay) {
      relay = openRelay(address, options.nodeSecret ?? '', connection.auth!, (frame) => connection.send(frame), () => {
        connection.relays.delete(address)
        // The other node is gone: the client reconnects and finds its documents anew
        connection.drop?.()
      })
      connection.relays.set(address, relay)
      relay.then((open) => {
        // Made after the client left: nothing else would close it
        if (!connections.has(connection)) {
          open.close()
        }
      }, () => connection.relays.delete(address))
    }
    return relay
  }

  // ---- Presence in namespaces ---------------------------------------------

  function presenceIn(namespace: string): PresenceEntry[] {
    const entries: PresenceEntry[] = []
    for (const connection of connections) {
      for (const { owner, opening } of connection.openings.values()) {
        if (owner.namespace === namespace && opening.mode === 'open') {
          entries.push({ principal: connection.principal, namespace, id: owner.id, mode: opening.presence.mode, visible: opening.presence.visible })
        }
      }
    }
    return entries
  }

  function schedulePresence(namespace: string) {
    if (presenceTimers.has(namespace)) {
      return
    }
    presenceTimers.set(namespace, setTimeout(() => {
      presenceTimers.delete(namespace)
      const frame = encodeFrame(ToClient.PRESENCE, { namespace, entries: presenceIn(namespace) })
      for (const connection of connections) {
        if (connection.following.has(namespace)) {
          connection.send(frame)
        }
      }
    }, 50))
  }

  // ---- Connections --------------------------------------------------------

  function connect(socket: WebSocket, request?: IncomingMessage) {
    const connection: Connection = {
      id: randomUUID(),
      socket,
      request,
      principal: { kind: 'person', id: '', name: '' },
      agents: false,
      openings: new Map(),
      following: new Set(),
      alive: true,
      relays: new Map(),
      remote: new Map(),
      // 1012: the service restarts; the client comes back
      drop: () => socket.close(1012, 'Come back: the document moved'),
      ended: (opening) => {
        if (connection.openings.get(opening.ref)?.opening === opening) {
          connection.openings.delete(opening.ref)
        }
      },
      send: (frame) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(frame)
        }
      }
    }
    socket.binaryType = 'arraybuffer'
    socket.on('message', (data: ArrayBuffer | Buffer) => {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      connection.alive = true
      if (bytes.length > limits.frame) {
        refuse(connection, 'over-limit', 'Frame too large')
        return
      }
      void receive(connection, bytes).catch((error: unknown) => {
        console.error('y-quorum: a frame failed', error)
      })
    })
    socket.on('close', () => {
      connections.delete(connection)
      for (const relay of connection.relays.values()) {
        void relay.then((open) => open.close(), () => undefined)
      }
      for (const { owner, opening } of connection.openings.values()) {
        owner.close(opening)
      }
      connection.openings.clear()
    })
    connections.add(connection)
  }

  function refuse(connection: Connection, code: ReasonCode, reason: string, close?: number) {
    connection.send(encodeFrame(ToClient.REFUSED, { code, reason }))
    if (close !== undefined) {
      connection.socket.close(close, reason)
    }
  }

  async function receive(connection: Connection, bytes: Uint8Array) {
    const frame = decodeFrame(bytes)
    if (!frame) {
      return
    }
    if (isFrame(frame, ToServer.HELLO)) {
      await hello(connection, frame.header)
      return
    }
    if (!connection.auth) {
      refuse(connection, 'unauthenticated', 'Say HELLO first', CloseCode.UNAUTHENTICATED)
      return
    }
    // A document held by another node: its frames go there as they are, but
    // a frame only a node may send
    const ref = (frame.header as { ref?: unknown }).ref
    const relayed = typeof ref === 'number' && frame.type !== ToServer.OPEN &&
      frame.type !== ToServer.NODE_MESSAGE
    const relay = relayed ? connection.remote.get(ref) : undefined
    if (relay) {
      relay.send(bytes)
      if (frame.type === ToServer.CLOSE) {
        connection.remote.delete(ref as number)
      }
      return
    }
    if (isFrame(frame, ToServer.PING)) {
      connection.send(encodeFrame(ToClient.PONG, {}))
    } else if (isFrame(frame, ToServer.TOKEN)) {
      await renew(connection, frame.header.token)
    } else if (isFrame(frame, ToServer.OPEN)) {
      await open(connection, frame.header, frame.payload)
    } else if (isFrame(frame, ToServer.CLOSE)) {
      const held = connection.openings.get(frame.header.ref)
      connection.openings.delete(frame.header.ref)
      held?.owner.close(held.opening)
    } else if (isFrame(frame, ToServer.UPDATE)) {
      const held = connection.openings.get(frame.header.ref)
      if (held?.opening.mode === 'open') {
        await held.owner.update(held.opening, frame.header, frame.payload)
      }
    } else if (isFrame(frame, ToServer.AWARENESS)) {
      const held = connection.openings.get(frame.header.ref)
      if (held?.opening.mode === 'open') {
        held.owner.awarenessFrom(held.opening, frame.payload)
      }
    } else if (isFrame(frame, ToServer.RECORD)) {
      const held = connection.openings.get(frame.header.ref)
      if (held) {
        await held.owner.record(held.opening, frame.header)
      }
    } else if (isFrame(frame, ToServer.SAVE)) {
      const held = connection.openings.get(frame.header.ref)
      held?.owner.save(held.opening, frame.header, frame.payload)
    } else if (isFrame(frame, ToServer.VERSION)) {
      const held = connection.openings.get(frame.header.ref)
      await held?.owner.version(held.opening, frame.header)
    } else if (isFrame(frame, ToServer.RESTORE)) {
      const held = connection.openings.get(frame.header.ref)
      await held?.owner.restore(held.opening, frame.header)
      if (held) {
        changed(held.owner)
      }
    } else if (isFrame(frame, ToServer.REVIEW)) {
      const held = connection.openings.get(frame.header.ref)
      await held?.owner.review(held.opening, frame.header)
    } else if (isFrame(frame, ToServer.UNREVIEWED)) {
      const held = connection.openings.get(frame.header.ref)
      if (held) {
        connection.send(encodeFrame(ToClient.RESULT, { call: frame.header.call, ok: true, value: held.owner.unreviewed() }))
      }
    } else if (isFrame(frame, ToServer.MODE)) {
      const held = connection.openings.get(frame.header.ref)
      held?.owner.setMode(held.opening, frame.header.mode, frame.header.visible)
    } else if (isFrame(frame, ToServer.PRESENCE)) {
      follow(connection, frame.header)
    } else if (isFrame(frame, ToServer.RPC)) {
      await call(connection, frame.header)
    } else if (isFrame(frame, ToServer.NODE_MESSAGE) && connection.link) {
      const { namespace, id, message } = frame.header
      void owners.get(keyOf(namespace, id))?.then((owner) => owner?.message(message))
    }
  }

  // Links to other nodes for what the server itself sends them, by address
  const nodeLinks = new Map<string, Promise<Relay>>()

  function linkTo(address: string): Promise<Relay> {
    let link = nodeLinks.get(address)
    if (!link) {
      const self: Principal = { kind: 'service', id: `node:${node!.id}`, name: `Node ${node!.id}` }
      const auth = { principal: self, namespaces: '*' as const, agents: false }
      link = openRelay(address, options.nodeSecret!, auth,
        () => undefined, () => nodeLinks.delete(address), { link: true })
      nodeLinks.set(address, link)
      link.catch(() => nodeLinks.delete(address))
    }
    return link
  }

  /** A host's message: to those with the document open here, or on the node holding it */
  async function sendMessage(namespace: string, id: string, message: unknown) {
    const here = owners.get(keyOf(namespace, id))
    if (here) {
      (await here)?.message(message)
      return
    }
    const lease = node && options.nodeSecret
      ? await options.storage.leaseOf?.(namespace, id)
      : undefined
    // Nobody holds it: nobody has it open
    if (!lease || lease.holder === node!.id || lease.until <= Date.now()) {
      return
    }
    const frame = encodeFrame(ToServer.NODE_MESSAGE, { namespace, id, message })
    ;(await linkTo(lease.address)).send(frame)
  }

  async function hello(connection: Connection, header: Headers[typeof ToServer.HELLO]) {
    if (header.protocol !== PROTOCOL_VERSION) {
      refuse(connection, 'stale-protocol', `This server speaks protocol ${PROTOCOL_VERSION}; reload`, CloseCode.STALE_PROTOCOL)
      return
    }
    // Once only: a fresh token comes as TOKEN, and is for the same principal
    if (connection.auth) {
      refuse(connection, 'unauthenticated', 'Already said HELLO; renew with TOKEN',
        CloseCode.PRINCIPAL_CHANGED)
      return
    }
    // Another node speaking for a client is who it says, by the secret they share
    const fromNode = readNodeToken(options.nodeSecret, header.token)
    const auth = fromNode?.auth ?? await options.authenticate(header.token, connection.request)
    if (!auth) {
      refuse(connection, 'unauthenticated', 'The token was refused', CloseCode.UNAUTHENTICATED)
      return
    }
    connection.fromNode = Boolean(fromNode)
    connection.link = fromNode?.link === true
    connection.auth = auth
    connection.principal = auth.principal
    connection.agents = auth.agents ?? auth.principal.kind === 'person'
    connection.send(encodeFrame(ToClient.WELCOME, { protocol: PROTOCOL_VERSION, principal: auth.principal, namespaces: auth.namespaces, limits }))
  }

  // A fresh token: the same principal, maybe other rights
  async function renew(connection: Connection, token: string) {
    // A relay renews with a node's token, as it began with one
    const node = readNodeToken(options.nodeSecret, token)
    // A node's token renews a node's connection only, and a client's a client's
    if (Boolean(node) !== Boolean(connection.fromNode) || (node && node.link !== connection.link)) {
      refuse(connection, 'unauthenticated', 'The token was refused', CloseCode.UNAUTHENTICATED)
      return
    }
    const auth = node?.auth ?? await options.authenticate(token, connection.request)
    const same = auth && auth.principal.id === connection.principal.id &&
      auth.principal.kind === connection.principal.kind
    if (!auth || !same) {
      refuse(connection, 'unauthenticated', auth ? 'The token is for someone else' : 'The token was refused',
        auth ? CloseCode.PRINCIPAL_CHANGED : CloseCode.UNAUTHENTICATED)
      return
    }
    connection.auth = auth
    connection.principal = auth.principal
    connection.agents = auth.agents ?? auth.principal.kind === 'person'
    for (const [ref, { owner, opening }] of connection.openings) {
      if (!mayEnter(auth, owner.namespace)) {
        connection.openings.delete(ref)
        owner.close(opening)
        connection.send(encodeFrame(ToClient.CLOSED, { ref, code: 'not-allowed', reason: 'No longer allowed here' }))
        continue
      }
      // Roles may have changed with the token: each document is asked again
      const roles = options.authorize
        ? await options.authorize({
          principal: auth.principal, namespace: owner.namespace, id: owner.id, type: owner.type.name
        })
        : ['editor']
      if (!roles || !owner.reauthorize(opening, roles)) {
        connection.openings.delete(ref)
        owner.close(opening)
        const reason = 'No longer allowed to read this document'
        connection.send(encodeFrame(ToClient.CLOSED, { ref, code: 'not-allowed', reason }))
        changed(owner)
      }
    }
    // Relays to other nodes speak with the new authentication from now on
    if (options.nodeSecret) {
      const renewed = encodeFrame(ToServer.TOKEN, { token: nodeToken(options.nodeSecret, auth) })
      for (const relay of connection.relays.values()) {
        void relay.then((open) => open.send(renewed), () => undefined)
      }
    }
  }

  function mayEnter(auth: Authenticated, namespace: string) {
    return auth.namespaces === '*' || auth.namespaces.includes(namespace)
  }

  async function open(connection: Connection, header: Headers[typeof ToServer.OPEN], vector: Uint8Array) {
    const closed = (code: ReasonCode, reason: string) => connection.send(encodeFrame(ToClient.CLOSED, { ref: header.ref, code, reason }))
    const auth = connection.auth!
    if (!mayEnter(auth, header.namespace)) {
      closed('not-allowed', `Not allowed in ${header.namespace}`)
      return
    }
    const counts = { open: 0, watch: 0 }
    for (const { opening } of connection.openings.values()) {
      counts[opening.mode]++
    }
    // A ref still in use: what it named before is closed first
    const earlier = connection.openings.get(header.ref)
    if (earlier) {
      connection.openings.delete(header.ref)
      earlier.owner.close(earlier.opening)
      counts[earlier.opening.mode]--
    }
    connection.remote.get(header.ref)?.send(encodeFrame(ToServer.CLOSE, { ref: header.ref }))
    connection.remote.delete(header.ref)
    if (counts[header.mode] >= limits[header.mode]) {
      closed('over-limit', `At most ${limits[header.mode]} documents may be ${header.mode === 'open' ? 'open' : 'watched'} on one connection`)
      return
    }
    if (node) {
      const where = await place(header.namespace, header.id)
      if (where !== 'here') {
        await forward(connection, header, vector, where)
        return
      }
    }
    const owner = await ownerOf(header.namespace, header.id)
    if (!owner) {
      closed('not-found', `No document ${header.namespace}/${header.id}`)
      return
    }
    const roles = options.authorize
      ? await options.authorize({ principal: connection.principal, namespace: header.namespace, id: header.id, type: owner.type.name })
      : ['editor']
    if (!roles) {
      closed('not-found', `No document ${header.namespace}/${header.id}`)
      changed(owner)
      return
    }
    const capabilities = owner.capabilitiesFor({ principal: connection.principal }, roles)
    if (!capabilities.read) {
      closed('not-allowed', 'Not allowed to read this document')
      changed(owner)
      return
    }
    const opening: Opening = {
      peer: connection,
      ref: header.ref,
      mode: header.mode,
      paths: header.paths ?? [],
      roles,
      capabilities,
      awarenessClients: new Set(),
      presence: { mode: 'reading', visible: true },
      held: []
    }
    // The client may have left while this was looked up: nothing would close it
    if (!connections.has(connection)) {
      changed(owner)
      return
    }
    connection.openings.set(header.ref, { owner, opening })
    await owner.open(opening, header, vector)
    if (!connections.has(connection)) {
      connection.openings.delete(header.ref)
      owner.close(opening)
    } else if (!owner.openings.has(opening)) {
      connection.openings.delete(header.ref)
    }
  }

  function follow(connection: Connection, header: Headers[typeof ToServer.PRESENCE]) {
    if (!header.follow) {
      connection.following.delete(header.namespace)
      return
    }
    if (!mayEnter(connection.auth!, header.namespace)) {
      return
    }
    connection.following.add(header.namespace)
    connection.send(encodeFrame(ToClient.PRESENCE, { namespace: header.namespace, entries: presenceIn(header.namespace) }))
  }

  async function call(connection: Connection, header: Headers[typeof ToServer.RPC]) {
    const handler = options.rpc?.[header.name]
    if (!handler) {
      connection.send(encodeFrame(ToClient.RESULT, { call: header.call, ok: false, code: 'not-found', reason: `No function ${header.name}` }))
      return
    }
    try {
      const value = await handler(header.args, { principal: connection.principal, server })
      connection.send(encodeFrame(ToClient.RESULT, { call: header.call, ok: true, value }))
    } catch (error) {
      connection.send(encodeFrame(ToClient.RESULT, { call: header.call, ok: false, code: 'invalid', reason: error instanceof Error ? error.message : String(error) }))
    }
  }

  // ---- Keepalive: a connection that stops answering is closed -----------------

  const keepalive = setInterval(() => {
    for (const connection of connections) {
      if (!connection.alive) {
        connection.socket.terminate()
        continue
      }
      connection.alive = false
      connection.socket.ping()
    }
  }, 30000)
  keepalive.unref()

  // ---- The server ---------------------------------------------------------

  function attach(httpServer: HttpServer, { path }: { path?: string } = {}) {
    sockets ??= new WebSocketServer({ noServer: true, maxPayload: limits.frame })
    httpServer.on('upgrade', (request, socket, head) => {
      // With a path, upgrades elsewhere are left to the server's other listeners
      if (path !== undefined && new URL(request.url ?? '/', 'http://localhost').pathname !== path) {
        return
      }
      sockets!.handleUpgrade(request, socket, head, (ws) => {
        ws.on('pong', () => {
          for (const connection of connections) {
            if (connection.socket === ws) {
              connection.alive = true
            }
          }
        })
        connect(ws, request)
      })
    })
  }

  const server: QuorumServer = {
    attach,
    listen: (port) => new Promise((resolve) => {
      http = createHttpServer((_request, response) => response.writeHead(404).end())
      attach(http)
      http.listen(port, () => resolve(http!))
    }),
    create: (namespace, id, type, initial, actor) => create(namespace, id, type, initial, [], actor),
    transact: async (namespace, id, actor, change) => {
      const owner = await localOwner(namespace, id)
      if (!owner) {
        throw new Error(`y-quorum: no document ${namespace}/${id}`)
      }
      const roles = options.authorize
        ? await options.authorize({ principal: actor.onBehalfOf ?? actor.principal, namespace, id, type: owner.type.name })
        : ['editor']
      const accepted = await owner.transact(actor, roles ?? [], change)
      changed(owner)
      return accepted
    },
    read: async (namespace, id) => {
      const owner = await localOwner(namespace, id)
      if (!owner) {
        return undefined
      }
      const json = owner.json()
      changed(owner)
      return json
    },
    exportHistory: async (namespace, id) => {
      // Loading folds what a stopped process left in the log; what is being
      // folded now goes into the chain first
      const owner = await localOwner(namespace, id)
      await owner?.flushHistoryNow()
      if (owner) {
        changed(owner)
      }
      return (await options.storage.history(namespace, id)).map(toJSONLine).join('\n')
    },
    unreviewed: async (namespace, id) => {
      const owner = await localOwner(namespace, id)
      if (!owner) {
        return undefined
      }
      const found = owner.unreviewed()
      changed(owner)
      return found
    },
    comments: async (namespace, id) => {
      const owner = await localOwner(namespace, id)
      if (!owner) {
        return undefined
      }
      const threads = owner.comments()
      changed(owner)
      return threads
    },
    appendRecord: async (namespace, id, actor: Actor, kind, data) => {
      const owner = await localOwner(namespace, id)
      if (!owner) {
        throw new Error(`y-quorum: no document ${namespace}/${id}`)
      }
      const principal = actor.onBehalfOf ?? actor.principal
      const roles = options.authorize
        ? await options.authorize({ principal, namespace, id, type: owner.type.name })
        : ['editor']
      const record = await owner.recordFrom(actor, roles ?? [], kind, data)
      changed(owner)
      return record
    },
    send: (namespace, id, message) => {
      void sendMessage(namespace, id, message).catch(() => undefined)
    },
    people: async (namespace, id) => {
      const owner = await localOwner(namespace, id)
      if (!owner) {
        return {}
      }
      changed(owner)
      return owner.register()
    },
    prune: async (namespace, id, before) => {
      const owner = await localOwner(namespace, id)
      if (!owner) {
        throw new Error(`y-quorum: no document ${namespace}/${id}`)
      }
      await owner.prune(before)
      changed(owner)
    },
    delete: async (namespace, id) => {
      for (const [key, pending] of owners) {
        const owner = await pending
        if (owner && owner.namespace === namespace && (id === undefined || owner.id === id)) {
          owner.closeAll('gone', 'The document was deleted')
          // Nothing more of it is written: not its history, nor to the host
          owner.giveUp()
          owners.delete(key)
          clearTimeout(unloading.get(key))
          unloading.delete(key)
        }
      }
      await options.storage.delete(namespace, id)
    },
    close: async () => {
      clearInterval(keepalive)
      for (const link of nodeLinks.values()) {
        void link.then((open) => open.close(), () => undefined)
      }
      // Leases are no longer renewed: a node shutting down lets its documents go
      for (const timer of renewals.values()) {
        clearInterval(timer)
      }
      for (const connection of connections) {
        connection.socket.close()
      }
      for (const pending of owners.values()) {
        const owner = await pending.catch(() => undefined)
        if (owner) {
          await owner.unload()
          letGo(owner)
        }
      }
      owners.clear()
      await new Promise<void>((resolve) => (sockets ? sockets.close(() => resolve()) : resolve()))
      await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()))
      await options.storage.close?.()
    }
  }
  return server
}

export type { Principal }
