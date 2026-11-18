// The shared document: a Hocuspocus server on ws://localhost:1234, holding the
// document "lab". It starts as the demo's article and keeps its state, edits
// included, for as long as the server runs.
import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import { slateNodesToInsertDelta } from '@slate-yjs/core'
import type { Descendant } from 'slate'
import { document as article } from '../../demo/src/document.ts'

const PORT = Number(process.env.LAB_PORT ?? 1234)
const saved = new Map<string, Uint8Array>()

const server = new Server({
  port: PORT,
  quiet: true,
  async onLoadDocument({ document, documentName }) {
    const state = saved.get(documentName)
    if (state) {
      Y.applyUpdate(document, state)
    } else {
      document.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta(article as Descendant[]))
    }
    return document
  },
  async onStoreDocument({ document, documentName }) {
    saved.set(documentName, Y.encodeStateAsUpdate(document))
  },
  async onConnect({ documentName }) {
    console.log(`joined ${documentName}`)
  }
})

await server.listen()
console.log(`Shared document server on ws://localhost:${PORT}`)
