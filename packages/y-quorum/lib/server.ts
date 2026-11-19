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
import { COMMENTS, createContent, seedComments, type CommentThread } from '@dotvoid/y-quorum-client/model'
import { DocumentOwner, type Opening, type Peer } from './document'
import type { Actor, Authenticated, QuorumServer, ServerOptions, ServerType, StoredDocument } from './types'
import type { HostStore } from './storage/host'

const DEFAULT_LIMITS: Limits = { open: 500, watch: 2000, frame: 4 * 1024 * 1024 }

/** A connection's own state */
interface Connection extends Peer {
  socket: WebSocket
  request?: IncomingMessage
  auth?: Authenticated
  openings: Map<number, { owner: DocumentOwner, opening: Opening }>
  following: Set<string>
  alive: boolean
}

export function createServer(options: ServerOptions): QuorumServer {
  const types = new Map<string, ServerType>(options.types.map((type) => [type.name, type]))
  const limits: Limits = { ...DEFAULT_LIMITS, ...options.limits }
  const owners = new Map<string, Promise<DocumentOwner | undefined>>()
  const unloading = new Map<string, ReturnType<typeof setTimeout>>()
  const connections = new Set<Connection>()
  const presenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const keyOf = (namespace: string, id: string) => `${namespace}\u0000${id}`
  let sockets: WebSocketServer | undefined
  let http: HttpServer | undefined

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
    return new DocumentOwner(namespace, id, type, stored, options.storage, options, changed)
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
    comments: CommentThread[] = []
  ): Promise<void> {
    const type = types.get(typeName)
    if (!type) {
      throw new Error(`y-quorum: no type ${typeName}`)
    }
    const doc = new Y.Doc()
    createContent(doc.get('content'), type.content, initial)
    if (type.comments && comments.length) {
      seedComments(doc.get(COMMENTS), comments)
    }
    await options.storage.create(namespace, id, { type: typeName, incarnation: randomUUID(), createdAt: Date.now() }, Y.encodeStateAsUpdate(doc))
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
          void owner.unload()
        }
      }, options.idle ?? 5000))
    }
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
      socket,
      request,
      principal: { kind: 'person', id: '', name: '' },
      agents: false,
      openings: new Map(),
      following: new Set(),
      alive: true,
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
    } else if (isFrame(frame, ToServer.MODE)) {
      const held = connection.openings.get(frame.header.ref)
      held?.owner.setMode(held.opening, frame.header.mode, frame.header.visible)
    } else if (isFrame(frame, ToServer.PRESENCE)) {
      follow(connection, frame.header)
    } else if (isFrame(frame, ToServer.RPC)) {
      await call(connection, frame.header)
    }
  }

  async function hello(connection: Connection, header: Headers[typeof ToServer.HELLO]) {
    if (header.protocol !== PROTOCOL_VERSION) {
      refuse(connection, 'stale-protocol', `This server speaks protocol ${PROTOCOL_VERSION}; reload`, CloseCode.STALE_PROTOCOL)
      return
    }
    const auth = await options.authenticate(header.token, connection.request)
    if (!auth) {
      refuse(connection, 'unauthenticated', 'The token was refused', CloseCode.UNAUTHENTICATED)
      return
    }
    connection.auth = auth
    connection.principal = auth.principal
    connection.agents = auth.agents ?? auth.principal.kind === 'person'
    connection.send(encodeFrame(ToClient.WELCOME, { protocol: PROTOCOL_VERSION, principal: auth.principal, namespaces: auth.namespaces, limits }))
  }

  // A fresh token: the same principal, maybe other rights
  async function renew(connection: Connection, token: string) {
    const auth = await options.authenticate(token, connection.request)
    if (!auth || auth.principal.id !== connection.principal.id) {
      refuse(connection, 'unauthenticated', auth ? 'The token is for someone else' : 'The token was refused',
        auth ? CloseCode.PRINCIPAL_CHANGED : CloseCode.UNAUTHENTICATED)
      return
    }
    connection.auth = auth
    connection.principal = auth.principal
    for (const [ref, { owner, opening }] of connection.openings) {
      if (!mayEnter(auth, owner.namespace)) {
        connection.openings.delete(ref)
        owner.close(opening)
        connection.send(encodeFrame(ToClient.CLOSED, { ref, code: 'not-allowed', reason: 'No longer allowed here' }))
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
    if (counts[header.mode] >= limits[header.mode]) {
      closed('over-limit', `At most ${limits[header.mode]} documents may be ${header.mode === 'open' ? 'open' : 'watched'} on one connection`)
      return
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
    const capabilities = owner.capabilitiesFor(connection.principal, roles)
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
      presence: { mode: header.mode === 'watch' ? 'watching' : 'reading', visible: true },
      held: []
    }
    connection.openings.set(header.ref, { owner, opening })
    await owner.open(opening, header, vector)
    if (!owner.openings.has(opening)) {
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

  function attach(httpServer: HttpServer) {
    sockets ??= new WebSocketServer({ noServer: true, maxPayload: limits.frame })
    httpServer.on('upgrade', (request, socket, head) => {
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
    create: (namespace, id, type, initial) => create(namespace, id, type, initial),
    transact: async (namespace, id, actor, change) => {
      const owner = await ownerOf(namespace, id)
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
      const owner = await ownerOf(namespace, id)
      if (!owner) {
        return undefined
      }
      const json = owner.json()
      changed(owner)
      return json
    },
    comments: async (namespace, id) => {
      const owner = await ownerOf(namespace, id)
      if (!owner) {
        return undefined
      }
      const threads = owner.comments()
      changed(owner)
      return threads
    },
    appendRecord: async (namespace, id, actor: Actor, kind, data) => {
      const owner = await ownerOf(namespace, id)
      if (!owner) {
        throw new Error(`y-quorum: no document ${namespace}/${id}`)
      }
      const record = await owner.appendRecord(actor, kind, data)
      changed(owner)
      return record
    },
    send: (namespace, id, message) => {
      void owners.get(keyOf(namespace, id))?.then((owner) => owner?.message(message))
    },
    delete: async (namespace, id) => {
      for (const [key, pending] of owners) {
        const owner = await pending
        if (owner && owner.namespace === namespace && (id === undefined || owner.id === id)) {
          owner.closeAll('gone', 'The document was deleted')
          owners.delete(key)
        }
      }
      await options.storage.delete(namespace, id)
    },
    close: async () => {
      clearInterval(keepalive)
      for (const connection of connections) {
        connection.socket.close()
      }
      for (const pending of owners.values()) {
        const owner = await pending
        await owner?.unload()
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
