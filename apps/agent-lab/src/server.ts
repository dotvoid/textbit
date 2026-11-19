// The shared document: a small Y.js 14 server on ws://localhost:1234, speaking
// the sync and awareness protocol of @y/protocols, one document per URL, as
// @y/websocket's provider expects. It stands in until the y-quorum server.
//
// Its state lives in .lab/ beside this folder, so it survives restarts.
//
// Clients that joined before a reset still hold the old document, and Y.js
// merges what a returning client holds: the article twice, with the same ids.
// So each incarnation of the document has a name of its own, lab-<epoch>, which
// clients ask for at http://localhost:1234/lab; a connection to any other name
// is closed with 4410, which tells a provider not to come back. `npm run
// lab:reset` starts a new incarnation.
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as awarenessProtocol from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { seedField } from '@dotvoid/textbit/headless'
import type { Descendant } from 'slate'
import { document as article } from '../../demo/src/document.ts'

const PORT = Number(process.env.LAB_PORT ?? 1234)
const FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../.lab')
const STATE = resolve(FOLDER, 'lab.y14state')
const EPOCH = resolve(FOLDER, 'epoch')

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const GONE = 4410

function initial(): { doc: Y.Doc, name: string } {
  const doc = new Y.Doc()
  if (existsSync(STATE) && existsSync(EPOCH)) {
    Y.applyUpdate(doc, readFileSync(STATE))
    return { doc, name: readFileSync(EPOCH, 'utf8').trim() }
  }
  seedField(doc.get('content'), article as Descendant[])
  const name = `lab-${Date.now().toString(36)}`
  mkdirSync(FOLDER, { recursive: true })
  writeFileSync(EPOCH, name)
  writeFileSync(STATE, Y.encodeStateAsUpdate(doc))
  return { doc, name }
}

const { doc, name } = initial()
const awareness = new awarenessProtocol.Awareness(doc)
awareness.setLocalState(null)

/** The awareness clients each connection speaks for, to remove when it goes */
const connections = new Map<WebSocket, Set<number>>()

const send = (socket: WebSocket, message: Uint8Array) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(message)
  }
}

// Every change, by anyone, goes to everyone else, and is stored a moment later
let storing: ReturnType<typeof setTimeout> | undefined
doc.on('update', (update: Uint8Array, origin: unknown) => {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  sync.writeUpdate(encoder, update)
  const message = encoding.toUint8Array(encoder)
  for (const socket of connections.keys()) {
    if (socket !== origin) {
      send(socket, message)
    }
  }
  clearTimeout(storing)
  storing = setTimeout(() => writeFileSync(STATE, Y.encodeStateAsUpdate(doc)), 500)
})

awareness.on('update', ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: unknown) => {
  const changed = [...added, ...updated, ...removed]
  const owned = connections.get(origin as WebSocket)
  if (owned) {
    added.forEach((client) => owned.add(client))
    removed.forEach((client) => owned.delete(client))
  }
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
  const message = encoding.toUint8Array(encoder)
  for (const socket of connections.keys()) {
    send(socket, message)
  }
})

function receive(socket: WebSocket, data: Uint8Array) {
  const decoder = decoding.createDecoder(data)
  const encoder = encoding.createEncoder()
  const type = decoding.readVarUint(decoder)
  if (type === MESSAGE_SYNC) {
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    sync.readSyncMessage(decoder, encoder, doc, socket)
    if (encoding.length(encoder) > 1) {
      send(socket, encoding.toUint8Array(encoder))
    }
  } else if (type === MESSAGE_AWARENESS) {
    awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), socket)
  }
}

function join(socket: WebSocket) {
  connections.set(socket, new Set())
  socket.on('message', (data: Buffer) => receive(socket, new Uint8Array(data)))
  socket.on('close', () => {
    const owned = connections.get(socket)
    connections.delete(socket)
    if (owned?.size) {
      awarenessProtocol.removeAwarenessStates(awareness, [...owned], null)
    }
  })
  // The server's state, and who is here
  const step1 = encoding.createEncoder()
  encoding.writeVarUint(step1, MESSAGE_SYNC)
  sync.writeSyncStep1(step1, doc)
  send(socket, encoding.toUint8Array(step1))
  const present = [...awareness.getStates().keys()]
  if (present.length) {
    const states = encoding.createEncoder()
    encoding.writeVarUint(states, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(states, awarenessProtocol.encodeAwarenessUpdate(awareness, present))
    send(socket, encoding.toUint8Array(states))
  }
}

const http = createServer((request, response) => {
  // GET /lab: the name of the current document
  if (request.url === '/lab') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    response.end(JSON.stringify({ document: name }))
    return
  }
  response.writeHead(404).end()
})

const sockets = new WebSocketServer({ server: http })
sockets.on('connection', (socket, request) => {
  const asked = decodeURIComponent((request.url ?? '/').slice(1).split('?')[0])
  if (asked !== name) {
    console.log(`turned away a client of ${asked}`)
    socket.close(GONE, `The lab document is now ${name}; join again`)
    return
  }
  console.log(`joined ${asked}`)
  join(socket)
})

http.listen(PORT, () => {
  console.log(`Shared document server on ws://localhost:${PORT}, document ${name}, state in ${FOLDER}`)
})
