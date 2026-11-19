import { describe, test, expect } from 'vitest'
import { Editor, Transforms, createEditor, Element, type Descendant } from 'slate'
import * as Y from '@y/y'
import { bindField, fieldToValue, seedField } from '../lib/yjs'
import { withNormalizeNode } from '../lib/with/withNormalizeNode'
import { withTextbitElements } from '../lib/with/withTextbitElements'
import { registerComponents } from '../lib/contexts/PluginRegistry/lib/registerComponents'
import type { PluginDefinition } from '../lib/types'

/**
 * Two edits that are each valid can merge into a block that breaks its
 * constraints. Editors do not repair what arrives from others: the peers agree
 * on the merged block, and the document's owner, here a third editor
 * normalizing, repairs it once for everyone. The repair need not be minimal,
 * but the peers must agree and the block must be valid.
 */

function plugin(min: number, max: number): PluginDefinition {
  return {
    class: 'block',
    name: 'test/fields',
    element: {
      class: 'block',
      children: [{ type: 'field', class: 'text', constraints: { min, max } }]
    }
  }
}

function field(id: string): Descendant {
  return { id, type: 'test/fields/field', class: 'text', properties: {}, children: [{ text: id }] } as Descendant
}

async function concurrently(
  definition: PluginDefinition,
  fields: string[],
  edits: [(editor: Editor) => void, (editor: Editor) => void]
): Promise<{ merged: [string[], string[]], repaired: [string[], string[]] }> {
  const components = registerComponents(
    registerComponents(new Map(), 'base/text', { type: 'base/text', class: 'text' }),
    definition.name,
    { type: definition.name, ...definition.element ?? { class: 'block' } }
  )
  const base = new Y.Doc()
  seedField(base.get('body'), [
    { id: 'x', type: 'test/fields', class: 'block', properties: {}, children: fields.map(field) } as Element
  ])

  const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
  const editors = docs.map((doc, i) => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(base))
    const editor = createEditor()
    bindField(editor, doc.get('body'), { origin: { peer: i } })
    withTextbitElements(editor)
    withNormalizeNode(editor, [definition], components)
    return editor
  })
  const [one, two, owner] = docs
  const sync = (a: Y.Doc, b: Y.Doc) => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  }

  edits.forEach((edit, i) => edit(editors[i]))
  sync(one, two)
  await Promise.resolve()

  const ids = (doc: Y.Doc): string[] => {
    const [block] = fieldToValue(doc.get('body'))
    return block ? block.children.map((c) => (c as { id: string }).id) : []
  }
  const merged: [string[], string[]] = [ids(one), ids(two)]

  sync(one, owner)
  Editor.normalize(editors[2], { force: true })
  sync(owner, one)
  sync(one, two)
  await Promise.resolve()

  return { merged, repaired: [ids(one), ids(two)] }
}

describe('concurrent edits that break a constraint', () => {
  test('two deletes below the minimum are repaired, and the peers agree', async () => {
    const { merged, repaired: [a, b] } = await concurrently(plugin(2, 5), ['f1', 'f2', 'f3'], [
      (editor) => Transforms.removeNodes(editor, { at: [0, 0] }),
      (editor) => Transforms.removeNodes(editor, { at: [0, 1] })
    ])

    expect(merged).toEqual([['f3'], ['f3']])
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThanOrEqual(2)
    expect(a).toContain('f3')
  })

  test('an exactly-one field deleted by both ends up as exactly one', async () => {
    const { merged, repaired: [a, b] } = await concurrently(plugin(1, 1), ['f1'], [
      (editor) => Transforms.removeNodes(editor, { at: [0, 0] }),
      (editor) => Transforms.removeNodes(editor, { at: [0, 0] })
    ])

    expect(merged[0]).toEqual(merged[1])
    expect(a).toEqual(b)
    expect(a).toHaveLength(1)
  })
})
