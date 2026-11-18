import { describe, test, expect } from 'vitest'
import { Transforms, createEditor, Element, type Descendant } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slateNodesToInsertDelta, withYjs, yTextToSlateElement } from '@slate-yjs/core'
import { withNormalizeNode } from '../lib/with/withNormalizeNode'
import { withTextbitElements } from '../lib/with/withTextbitElements'
import { registerComponents } from '../lib/contexts/PluginRegistry/lib/registerComponents'
import type { PluginDefinition } from '../lib/types'

/**
 * Two edits that are each valid can merge into a block that breaks its
 * constraints. Every peer then repairs it on arrival. The repairs need not be
 * minimal, but the peers must agree and the block must be valid.
 */

function plugin(min: number, max: number): PluginDefinition {
  return {
    class: 'block',
    name: 'test/fields',
    componentEntry: {
      class: 'block',
      component: () => null,
      children: [{ type: 'field', class: 'text', component: () => null, constraints: { min, max } }]
    }
  }
}

function field(id: string): Descendant {
  return { id, type: 'test/fields/field', class: 'text', properties: {}, children: [{ text: id }] } as Descendant
}

async function concurrently(
  definition: PluginDefinition,
  fields: string[],
  edits: [(editor: YjsEditor) => void, (editor: YjsEditor) => void]
): Promise<[string[], string[]]> {
  const components = registerComponents(
    registerComponents(new Map(), 'base/text', { class: 'text', component: () => null }),
    definition.name,
    definition.componentEntry!
  )
  const base = new Y.Doc()
  base.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta([
    { id: 'x', type: 'test/fields', class: 'block', properties: {}, children: fields.map(field) } as Descendant
  ]))

  const docs = [new Y.Doc(), new Y.Doc()]
  const editors = docs.map((doc, i) => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
    const editor = withYjs(createEditor(), doc.get('content', Y.XmlText), { localOrigin: Symbol(String(i)) })
    withTextbitElements(editor)
    withNormalizeNode(editor, [definition], components)
    YjsEditor.connect(editor)
    return editor
  })

  edits.forEach((edit, i) => {
    edit(editors[i])
    YjsEditor.flushLocalChanges(editors[i])
  })

  for (let round = 0; round < 3; round++) {
    Y.applyUpdate(docs[1], Y.encodeStateAsUpdate(docs[0], Y.encodeStateVector(docs[1])))
    Y.applyUpdate(docs[0], Y.encodeStateAsUpdate(docs[1], Y.encodeStateVector(docs[0])))
    await Promise.resolve()
  }

  const ids = (doc: Y.Doc) => {
    const [block] = yTextToSlateElement(doc.get('content', Y.XmlText)).children
    return Element.isElement(block) ? block.children.map((c) => (c as { id: string }).id) : []
  }
  return [ids(docs[0]), ids(docs[1])]
}

describe('concurrent edits that break a constraint', () => {
  test('two deletes below the minimum are repaired, and the peers agree', async () => {
    const [a, b] = await concurrently(plugin(2, 5), ['f1', 'f2', 'f3'], [
      (editor) => Transforms.removeNodes(editor, { at: [0, 0] }),
      (editor) => Transforms.removeNodes(editor, { at: [0, 1] })
    ])

    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThanOrEqual(2)
    expect(a).toContain('f3')
  })

  test('an exactly-one field deleted by both ends up as exactly one', async () => {
    const [a, b] = await concurrently(plugin(1, 1), ['f1'], [
      (editor) => Transforms.removeNodes(editor, { at: [0, 0] }),
      (editor) => Transforms.removeNodes(editor, { at: [0, 0] })
    ])

    expect(a).toEqual(b)
    expect(a).toHaveLength(1)
  })
})
