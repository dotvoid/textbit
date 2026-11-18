import { describe, test, expect } from 'vitest'
import { Transforms, createEditor, Element, type Descendant, type Editor } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slateNodesToInsertDelta, withYjs, yTextToSlateElement } from '@slate-yjs/core'
import { withNormalizeNode } from '../lib/with/withNormalizeNode'
import { withRemoteNormalization } from '../lib/with/withRemoteNormalization'
import { withTextbitElements } from '../lib/with/withTextbitElements'
import { registerComponents } from '../lib/contexts/PluginRegistry/lib/registerComponents'
import type { PluginRegistryComponent } from '../lib/contexts/PluginRegistry/lib/types'
import type { PluginDefinition } from '../lib/types'

/**
 * Content from another peer is the shared document's state. If every peer
 * repaired it on arrival, each would write its own repair into the shared
 * document and they would add up: two peers inserting a missing field give two
 * fields. A change is repaired by the peer that makes it.
 */

const twoFields: PluginDefinition = {
  class: 'block',
  name: 'test/two',
  componentEntry: {
    class: 'block',
    component: () => null,
    children: [{ type: 'field', class: 'text', component: () => null, constraints: { min: 2, max: 5 } }]
  }
}

const COMPONENTS: Map<string, PluginRegistryComponent> = registerComponents(
  registerComponents(new Map(), 'base/text', { class: 'text', component: () => null }),
  twoFields.name,
  twoFields.componentEntry
)

function field(id: string, text: string): Descendant {
  return { id, type: 'test/two/field', class: 'text', properties: {}, children: [{ text }] } as Descendant
}

function block(id: string, fields: Descendant[]): Descendant {
  return { id, type: 'test/two', class: 'block', properties: {}, children: fields } as Descendant
}

function paragraph(id: string, text: string): Descendant {
  return { id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] } as Descendant
}

function peer(doc: Y.Doc, name: string): Editor & YjsEditor {
  const root = doc.get('content', Y.XmlText)
  const editor = withYjs(createEditor(), root, { localOrigin: Symbol(name) })
  withTextbitElements(editor)
  withNormalizeNode(editor, [twoFields], COMPONENTS)
  withRemoteNormalization(editor)
  YjsEditor.connect(editor)
  return editor
}

function sync(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
}

function fieldCount(doc: Y.Doc): number {
  const [first] = yTextToSlateElement(doc.get('content', Y.XmlText)).children
  return Element.isElement(first) ? first.children.length : -1
}

function seeded(nodes: Descendant[]): Y.Doc {
  const doc = new Y.Doc()
  doc.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta(nodes))
  return doc
}

describe('remote changes are not repaired by every peer', () => {
  test('two peers receiving a block with too few fields do not both add one', async () => {
    const base = seeded([paragraph('p', 'start')])
    const a = new Y.Doc()
    const b = new Y.Doc()
    sync(base, a)
    sync(base, b)
    peer(a, 'a')
    peer(b, 'b')
    await Promise.resolve()

    // A third writer adds a block with one field, below the minimum of two
    const writer = new Y.Doc()
    sync(base, writer)
    writer.get('content', Y.XmlText).applyDelta(
      [{ retain: 1 }, ...slateNodesToInsertDelta([block('x', [field('f1', 'one')])])]
    )
    sync(writer, a)
    sync(writer, b)
    await Promise.resolve()

    sync(a, b)
    sync(b, a)
    await Promise.resolve()

    const [, inserted] = yTextToSlateElement(a.get('content', Y.XmlText)).children
    expect(Element.isElement(inserted) && inserted.children.length).toBe(1)
    expect(fieldCount(a)).toBe(fieldCount(b))
  })

  test('content that is invalid when a peer connects is left as it is', async () => {
    const doc = seeded([block('x', [field('f1', 'one')])])
    peer(doc, 'a')
    await Promise.resolve()

    expect(fieldCount(doc)).toBe(1)
  })

  test('the peer that edits invalid content repairs it', async () => {
    const doc = seeded([block('x', [field('f1', 'one')])])
    const editor = peer(doc, 'a')
    await Promise.resolve()

    Transforms.insertText(editor, '!', { at: { path: [0, 0, 0], offset: 3 } })
    YjsEditor.flushLocalChanges(editor)

    expect(fieldCount(doc)).toBe(2)
  })
})
