// The shared document: a Hocuspocus server on ws://localhost:1234. It starts
// as the demo's article.
//
// Its state lives in .lab/ beside this folder, so it survives restarts, and
// every load of the document applies that same state.
//
// Clients that joined before a reset still hold the old document, and Y.js
// merges what a returning client holds: the article twice, with the same ids.
// So each incarnation of the document has a name of its own, lab-<epoch>, which
// clients ask for at http://localhost:1234/lab, and the server turns away any
// other. `npm run lab:reset` starts a new incarnation.
import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import { slateNodesToInsertDelta } from '@slate-yjs/core'
import type { Descendant } from 'slate'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { document as article } from '../../demo/src/document.ts'

const PORT = Number(process.env.LAB_PORT ?? 1234)
const FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../.lab')
const STATE = resolve(FOLDER, 'lab.ystate')
const EPOCH = resolve(FOLDER, 'epoch')

function initial(): { state: Uint8Array, name: string } {
  if (existsSync(STATE) && existsSync(EPOCH)) {
    return { state: readFileSync(STATE), name: readFileSync(EPOCH, 'utf8').trim() }
  }
  const seed = new Y.Doc()
  seed.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta(article as Descendant[]))
  const state = Y.encodeStateAsUpdate(seed)
  const name = `lab-${Date.now().toString(36)}`
  mkdirSync(FOLDER, { recursive: true })
  writeFileSync(EPOCH, name)
  writeFileSync(STATE, state)
  return { state, name }
}

let { state, name } = initial()

const server = new Server({
  port: PORT,
  quiet: true,
  // GET /lab: the name of the current document
  async onRequest({ request, response }) {
    if (request.url === '/lab') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      response.end(JSON.stringify({ document: name }))
      // Handled: nothing else answers
      throw null
    }
  },
  // Every client authenticates, with any token: here the document it asks
  // for is checked. One from before a reset is turned away, and its copy never
  // reaches the document.
  async onAuthenticate({ documentName }) {
    if (documentName !== name) {
      console.log(`turned away a client of ${documentName}`)
      throw new Error(`The lab document is now ${name}; join again`)
    }
  },
  async onConnect({ documentName }) {
    console.log(`joined ${documentName}`)
  },
  async onLoadDocument({ document, documentName }) {
    if (documentName === name) {
      Y.applyUpdate(document, state)
    }
    return document
  },
  async onStoreDocument({ document, documentName }) {
    if (documentName === name) {
      state = Y.encodeStateAsUpdate(document)
      writeFileSync(STATE, state)
    }
  }
})

await server.listen()
console.log(`Shared document server on ws://localhost:${PORT}, document ${name}, state in ${FOLDER}`)
