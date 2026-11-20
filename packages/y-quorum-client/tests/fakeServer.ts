// A small stand-in for the y-quorum server: one document, the exchange the
// client relies on, and switches to make it refuse things.
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from '@y/y'
import {
  PROTOCOL_VERSION,
  ToClient,
  ToServer,
  decodeFrame,
  encodeFrame,
  isFrame,
  type FrameType,
  type Headers,
  type Layer,
  type Limits
} from '../lib/protocol'

interface Received {
  type: FrameType
  header: Record<string, unknown>
  payload: Uint8Array
}

interface Connection {
  socket: WebSocket
  /** Refs open on this connection: their mode and, for watching, the paths */
  refs: Map<number, { mode: 'open' | 'watch', paths: string[], refused: boolean }>
}

export interface FakeServer {
  url: string
  doc: Y.Doc
  received: Received[]
  limits: Limits
  incarnation: string
  /** Refuse the next UPDATE, and every later one on the same opening */
  refuseNextUpdate: boolean
  /** Answer the next OPEN with client-id-taken */
  takeNextClientId: boolean
  /** Whether the document's type has comments and suggestions, each layer a Y.Doc here */
  layered: boolean
  layers: Record<Exclude<Layer, 'content'>, Y.Doc>
  framesOf(type: FrameType): Received[]
  /** Drops every connection, as a network failure would */
  drop(): void
  close(): Promise<void>
}

export async function startServer(): Promise<FakeServer> {
  const wss = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
  const address = wss.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const connections = new Set<Connection>()
  let log = 0

  const server: FakeServer = {
    url: `ws://127.0.0.1:${port}`,
    doc: new Y.Doc(),
    received: [],
    limits: { open: 10, watch: 10, frame: 1_000_000 },
    incarnation: 'one',
    refuseNextUpdate: false,
    takeNextClientId: false,
    layered: false,
    layers: { comments: new Y.Doc(), suggestions: new Y.Doc({ gc: false, isSuggestionDoc: true }) },
    framesOf: (type) => server.received.filter((frame) => frame.type === type),
    drop: () => {
      for (const connection of connections) {
        connection.socket.terminate()
      }
    },
    close: () => new Promise((resolve) => {
      server.drop()
      wss.close(() => resolve())
    })
  }

  // Changes reach every opening but the one they came from; watchers get
  // their projection again
  const forward = (layer: Layer) => (update: Uint8Array, origin: unknown) => {
    for (const connection of connections) {
      for (const [ref, opening] of connection.refs) {
        if (opening.mode === 'watch') {
          if (layer === 'content') {
            send(connection, ToClient.PROJECTION, { ref, projection: project(opening.paths) })
          }
        } else if (origin !== opening) {
          send(connection, ToClient.UPDATE, { ref, layer }, update)
        }
      }
    }
  }
  // The fork follows the content, as the server's does; clients' forks get it from their content
  const following = {}
  server.doc.on('update', (update: Uint8Array) => {
    Y.applyUpdate(server.layers.suggestions, update, following)
  })
  server.doc.on('update', forward('content'))
  server.layers.comments.on('update', forward('comments'))
  server.layers.suggestions.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== following) {
      forward('suggestions')(update, origin)
    }
  })
  const docOf = (layer: Layer) => layer === 'content' ? server.doc : server.layers[layer]

  function project(paths: string[]): Record<string, unknown> {
    const content = server.doc.get('content')
    return Object.fromEntries(paths.map((path) => [path, content.getAttr(path)]))
  }

  function send<T extends FrameType>(
    connection: Connection,
    type: T,
    header: Headers[T],
    payload?: Uint8Array
  ) {
    connection.socket.send(encodeFrame(type, header, payload))
  }

  wss.on('connection', (socket) => {
    const connection: Connection = { socket, refs: new Map() }
    connections.add(connection)
    socket.on('close', () => connections.delete(connection))
    socket.on('message', (data: Buffer) => {
      const frame = decodeFrame(new Uint8Array(data))
      if (!frame) {
        return
      }
      server.received.push({
        type: frame.type,
        header: frame.header as Record<string, unknown>,
        payload: frame.payload
      })
      if (isFrame(frame, ToServer.HELLO)) {
        if (frame.header.token !== 'good') {
          send(connection, ToClient.REFUSED, { code: 'unauthenticated', reason: 'bad token' })
          socket.close(4401)
          return
        }
        send(connection, ToClient.WELCOME, {
          protocol: PROTOCOL_VERSION,
          principal: { kind: 'person', id: 'p1', name: 'Pat' },
          namespaces: '*',
          limits: server.limits
        })
      } else if (isFrame(frame, ToServer.OPEN)) {
        const { ref, mode } = frame.header
        if (mode === 'open' && server.takeNextClientId) {
          server.takeNextClientId = false
          send(connection, ToClient.CLOSED, { ref, code: 'client-id-taken', reason: 'taken' })
          return
        }
        const paths = frame.header.paths ?? []
        const opening = { mode, paths, refused: false }
        connection.refs.set(ref, opening)
        const common = {
          ref,
          type: 'test/doc',
          incarnation: server.incarnation,
          capabilities: { read: true, write: true },
          seq: log
        }
        if (mode === 'watch') {
          send(connection, ToClient.OPENED, { ...common, projection: project(paths) })
          return
        }
        const stateVector = Buffer.from(Y.encodeStateVector(server.doc)).toString('base64')
        const missing = Y.encodeStateAsUpdate(server.doc, frame.payload)
        const layers = server.layered ? layersFor(frame.header.layers ?? {}) : undefined
        const header = { ...common, stateVector, records: [], ...(layers ? { layers } : {}) }
        send(connection, ToClient.OPENED, header, missing)
      } else if (isFrame(frame, ToServer.UPDATE)) {
        const { ref, seq } = frame.header
        const opening = connection.refs.get(ref)
        if (!opening) {
          return
        }
        if (server.refuseNextUpdate || opening.refused) {
          server.refuseNextUpdate = false
          opening.refused = true
          const header = { ref, seq, code: 'not-allowed' as const, reason: 'read-only' }
          send(connection, ToClient.REJECTED, header, frame.payload)
          return
        }
        Y.applyUpdate(docOf(frame.header.layer), frame.payload, opening)
        send(connection, ToClient.ACK, { ref, seq, log: ++log })
      } else if (isFrame(frame, ToServer.CLOSE)) {
        connection.refs.delete(frame.header.ref)
      } else if (isFrame(frame, ToServer.RPC)) {
        const { call, name, args } = frame.header
        if (name === 'fail') {
          send(connection, ToClient.RESULT, { call, ok: false, code: 'not-allowed', reason: 'no' })
        } else {
          send(connection, ToClient.RESULT, { call, ok: true, value: { name, args } })
        }
      } else if (isFrame(frame, ToServer.SAVE)) {
        send(connection, ToClient.SAVED, { ref: frame.header.ref, call: frame.header.call, log })
      } else if (isFrame(frame, ToServer.PING)) {
        send(connection, ToClient.PONG, {})
      }
    })
  })

  // The layers an opening asked for, by its state vectors
  function layersFor(asked: Partial<Record<Layer, string>>) {
    const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
    const entries = (['comments', 'suggestions'] as const).map((layer) => {
      const doc = server.layers[layer]
      const theirs = asked[layer] ? Buffer.from(asked[layer], 'base64') : undefined
      return [layer, {
        stateVector: base64(Y.encodeStateVector(doc)),
        missing: base64(Y.encodeStateAsUpdate(doc, theirs))
      }] as const
    })
    return Object.fromEntries(entries)
  }

  return server
}

/** Waits until a condition holds, polling */
export async function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor: timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
