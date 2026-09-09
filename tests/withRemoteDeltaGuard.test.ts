import { describe, test, expect } from 'vitest'
import { Editor, Node, Transforms, createEditor, type Descendant } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slateNodesToInsertDelta, withYjs } from '@slate-yjs/core'
import { withRemoteDeltaGuard } from '../lib/with/withRemoteDeltaGuard'

/**
 * `@slate-yjs/core@1.0.2` reverses each remote delta in place, and Yjs hands
 * the same cached array to every observer. These tests pin the guard that hands
 * each editor its own copy - without it every second applier in the observer
 * chain writes remote text at the wrong offset. Note that the inserts below are
 * at a non-zero offset: an edit at offset 0 produces a single-op delta, which
 * reverses to itself and passes even when the guard is gone.
 */

function paragraph(id: string, text: string): Descendant {
  return {
    id,
    type: 'core/text',
    class: 'text',
    properties: {},
    children: [{ text }]
  } as unknown as Descendant
}

function seededDoc(text = 'test'): { doc: Y.Doc, root: Y.XmlText } {
  const doc = new Y.Doc()
  const root = doc.get('content', Y.XmlText)
  root.applyDelta(slateNodesToInsertDelta([paragraph('a', text)]))
  return { doc, root }
}

function connectEditor(root: Y.XmlText, name: string): Editor & YjsEditor {
  const editor = withRemoteDeltaGuard(
    withYjs(createEditor(), root, { localOrigin: Symbol(name) })
  )
  YjsEditor.connect(editor)
  return editor
}

/**
 * Apply a change that neither local editor originated: clone the doc, edit the
 * clone, then feed the update back. A local edit is skipped by its own editor,
 * so it only exercises part of the observer chain.
 */
function remoteInsert(doc: Y.Doc, offset: number, text: string): void {
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))

  const replicaRoot = replica.get('content', Y.XmlText)
  const replicaParagraph = replicaRoot.toDelta()[0].insert as Y.XmlText
  replicaParagraph.insert(offset, text)

  Y.applyUpdate(doc, Y.encodeStateAsUpdate(replica, Y.encodeStateVector(doc)))
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('withRemoteDeltaGuard', () => {
  test('two editors on one shared root apply a remote insert identically', () => {
    const { doc, root } = seededDoc()
    const first = connectEditor(root, 'first')
    const second = connectEditor(root, 'second')

    remoteInsert(doc, 2, '9')

    expect(Node.string(first)).toBe('te9st')
    expect(Node.string(second)).toBe('te9st')
  })

  test('the whole observer chain stays correct, not just every other editor', () => {
    const { doc, root } = seededDoc()
    const editors = ['first', 'second', 'third', 'fourth', 'fifth']
      .map(name => connectEditor(root, name))

    remoteInsert(doc, 2, '9')

    expect(editors.map(editor => Node.string(editor))).toEqual([
      'te9st', 'te9st', 'te9st', 'te9st', 'te9st'
    ])
  })

  test('an edit from one editor lands at the same offset in the others', async () => {
    const { root } = seededDoc()
    const editors = ['first', 'second', 'third'].map(name => connectEditor(root, name))
    const [, typing] = editors

    Transforms.insertText(typing, '9', { at: { path: [0, 0], offset: 2 } })
    await flush()

    expect(editors.map(editor => Node.string(editor))).toEqual(['te9st', 'te9st', 'te9st'])
  })

  test('leaves the cached delta unreversed for other observers of the root', () => {
    // A single editor is enough: unguarded it reverses the cached array once
    // and every observer registered after it reads the ops backwards. An even
    // number of unguarded editors would reverse it back and hide that.
    const { doc, root } = seededDoc()
    connectEditor(root, 'only')

    const seen: unknown[][] = []
    root.observeDeep((events) => {
      events.forEach(event => seen.push(event.delta))
    })

    remoteInsert(doc, 2, '9')

    expect(seen).toContainEqual([{ retain: 2 }, { insert: '9' }])
  })
})
