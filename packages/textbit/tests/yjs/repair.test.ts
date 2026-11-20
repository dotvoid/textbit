// Repairing a shared text field: what two people's valid changes at once can
// break, put right by the one process that repairs
import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import {
  createTextbitEditor, fieldToValue, repairField, seedField, validate
} from '../../lib/headless'

const p = (id: string, text: string): Descendant =>
  ({ id, class: 'text', type: 'base/text', children: [{ text }] }) as Descendant

function two(value: Descendant[]) {
  const one = new Y.Doc()
  seedField(one.get('f'), structuredClone(value))
  const other = new Y.Doc()
  Y.applyUpdate(other, Y.encodeStateAsUpdate(one))
  const a = createTextbitEditor({ shared: one.get('f') })
  const b = createTextbitEditor({ shared: other.get('f') })
  const sync = () => {
    const toOne = Y.encodeStateAsUpdate(other, Y.encodeStateVector(one))
    const toOther = Y.encodeStateAsUpdate(one, Y.encodeStateVector(other))
    Y.applyUpdate(one, toOne)
    Y.applyUpdate(other, toOther)
  }
  return { one, other, a, b, sync }
}

const ids = (field: Y.Node) => fieldToValue(field).map((block) => block.id)
const texts = (field: Y.Node) => fieldToValue(field).map((block) => Node.string(block))

describe('repairing a shared text field', () => {
  it('removes the copy two people make by moving the same block at once', () => {
    const { one, other, a, b, sync } = two([p('a', 'One'), p('b', 'Two'), p('c', 'Three')])
    Transforms.moveNodes(a, { at: [2], to: [0] })
    Transforms.moveNodes(b, { at: [2], to: [1] })
    sync()
    // Y.js moves by copying: both copies are there, on both sides
    expect(ids(one.get('f'))).toEqual(['c', 'a', 'c', 'b'])
    expect(validate(fieldToValue(one.get('f'))).map((issue) => issue.code))
      .toContain('duplicate-id')

    expect(repairField(one.get('f'))).toBe(true)
    sync()
    expect(ids(one.get('f'))).toEqual(['c', 'a', 'b'])
    expect(ids(other.get('f'))).toEqual(['c', 'a', 'b'])
    // The editors follow; nothing broken is left
    expect(a.children.map((block) => (block as { id: string }).id)).toEqual(['c', 'a', 'b'])
    expect(validate(fieldToValue(one.get('f')))).toEqual([])
  })

  it('keeps a copy that someone changed, under an id of its own', () => {
    const { one, a, b, sync } = two([p('a', 'One'), p('b', 'Two'), p('c', 'Three')])
    Transforms.moveNodes(a, { at: [2], to: [0] })
    Transforms.moveNodes(b, { at: [2], to: [1] })
    Transforms.insertText(b, ' more', { at: Editor.end(b, [1]) })
    sync()
    expect(repairField(one.get('f'))).toBe(true)
    const value = fieldToValue(one.get('f'))
    expect(texts(one.get('f'))).toEqual(['Three', 'One', 'Three more', 'Two'])
    expect(value[0].id).toBe('c')
    expect(value[2].id).not.toBe('c')
    expect(validate(value)).toEqual([])
  })

  it('writes nothing to a field that is right', () => {
    const doc = new Y.Doc()
    seedField(doc.get('f'), [p('a', 'One'), p('b', 'Two')])
    const updates: Uint8Array[] = []
    doc.on('update', (update: Uint8Array) => updates.push(update))
    expect(repairField(doc.get('f'))).toBe(false)
    expect(updates).toEqual([])
  })

  it('leaves the copies to the repair: shared editors do not remove them themselves', () => {
    const { one, other, a, b, sync } = two([p('a', 'One'), p('b', 'Two'), p('c', 'Three')])
    Transforms.moveNodes(a, { at: [2], to: [0] })
    Transforms.moveNodes(b, { at: [2], to: [1] })
    sync()
    // Each person goes on typing; neither removes a copy, so neither loses one
    Transforms.insertText(a, '!', { at: Editor.end(a, [1]) })
    Transforms.insertText(b, '?', { at: Editor.end(b, [3]) })
    sync()
    expect(ids(one.get('f'))).toEqual(['c', 'a', 'c', 'b'])
    expect(texts(other.get('f'))).toEqual(['Three', 'One!', 'Three', 'Two?'])
  })
})
