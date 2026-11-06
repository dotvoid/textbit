import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { slateNodesToInsertDelta } from '@slate-yjs/core'
import type { Descendant } from 'slate'

export type Peer = {
  value: Y.XmlText
  awareness: Awareness
}

/**
 * Two peers editing one document, in one page: each has its own Y.Doc and
 * awareness, so they are told apart as they would be over a network, and every
 * update is relayed to the other.
 */
export function sharedDocument(content: Descendant[]): [Peer, Peer] {
  const docs = [new Y.Doc(), new Y.Doc()]
  const awareness = docs.map((doc) => new Awareness(doc))

  docs[0].on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== docs[1]) Y.applyUpdate(docs[1], update, docs[0])
  })
  docs[1].on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== docs[0]) Y.applyUpdate(docs[0], update, docs[1])
  })
  relay(awareness[0], awareness[1])
  relay(awareness[1], awareness[0])

  const values = docs.map((doc) => doc.get('content', Y.XmlText))
  values[0].applyDelta(slateNodesToInsertDelta(content))

  return [
    { value: values[0], awareness: awareness[0] },
    { value: values[1], awareness: awareness[1] }
  ]
}

function relay(from: Awareness, to: Awareness) {
  from.on('update', ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: unknown) => {
    if (origin !== to) {
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [...added, ...updated, ...removed]), from)
    }
  })
}
