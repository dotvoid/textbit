import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Node, Text, Transforms } from 'slate'
import { bindField } from '../../lib/yjs/binding'
import { SUGGESTED_MARK as SUGGESTED, seedField, fieldToValue as toSlateValue } from '../../lib/yjs/model'
import { addItem, createPlan, findItem, listOf, textField } from './_tree'
import { makeEditor } from './_helpers'

function setup() {
  const base = new Y.Doc({ gc: false })
  const root = createPlan(base, { due: '2026-12-01' })
  const list = listOf(root, 'assignments')
  addItem(list, { id: 'text', pos: 'm', status: 'todo' })
  seedField(textField(findItem(list, 'text')!, 'description'), [
    { id: 'd1', type: 'core/text', class: 'text', children: [{ text: 'Write 600 words.' }] }
  ])
  const fork = new Y.Doc({ gc: false, isSuggestionDoc: true })
  Y.applyUpdate(fork, Y.encodeStateAsUpdate(base))
  const renderer = Y.createDiffRenderer(base, fork)
  fork.get('content').useRenderer(renderer)
  const baseField = textField(findItem(list, 'text')!, 'description')
  const forkField = textField(findItem(listOf(fork.get('content'), 'assignments'), 'text')!, 'description')
  return { renderer, baseField, forkField }
}

// The leaves of the first block as [text, suggested]
function leaves(children: ReturnType<typeof toSlateValue>) {
  return children[0].children.filter(Text.isText).map((t) => [t.text, t[SUGGESTED] ?? ''])
}

describe('suggesting in the fork', () => {
  it('shows what a person suggests, struck and inserted, and leaves the document alone', () => {
    const { baseField, forkField, renderer } = setup()
    const suggester = makeEditor()
    const binding = bindField(suggester, forkField, { renderer })
    const reader = makeEditor()
    bindField(reader, baseField)

    Transforms.delete(suggester, { at: { anchor: { path: [0, 0], offset: 6 }, focus: { path: [0, 0], offset: 10 } } })
    expect(binding.check()).toBe(true)
    // The deleted words stay, shown as deleted
    expect(Node.string(suggester.children[0])).toBe('Write 600 words.')
    const typeAt = suggester.children[0] as { children: Text[] }
    const before = typeAt.children.findIndex((t) => t[SUGGESTED] === 'delete')
    Transforms.insertText(suggester, 'about 800 ', { at: { path: [0, before], offset: 0 } })
    expect(binding.check()).toBe(true)
    expect(leaves(suggester.children as ReturnType<typeof toSlateValue>)).toEqual([
      ['Write ', ''], ['about 800 ', 'insert'], ['600 ', 'delete'], ['words.', '']
    ])
    expect(Node.string(reader.children[0])).toBe('Write 600 words.')

    // A person fixes a typo in their own suggestion: it is still a suggestion
    const inserted = (suggester.children[0] as { children: Text[] }).children.findIndex((t) => t[SUGGESTED] === 'insert')
    Transforms.delete(suggester, { at: { path: [0, inserted], offset: 6 }, distance: 4 })
    expect(leaves(suggester.children as ReturnType<typeof toSlateValue>)).toEqual([
      ['Write ', ''], ['about ', 'insert'], ['600 ', 'delete'], ['words.', '']
    ])

    renderer.acceptAllChanges()
    expect(Node.string(reader.children[0])).toBe('Write about words.')
    expect(leaves(suggester.children as ReturnType<typeof toSlateValue>)).toEqual([['Write about words.', '']])
    expect(binding.check()).toBe(true)
  })

  it('rejects what was suggested', () => {
    const { baseField, forkField, renderer } = setup()
    const suggester = makeEditor()
    const binding = bindField(suggester, forkField, { renderer })
    Transforms.insertText(suggester, 'Please ', { at: { path: [0, 0], offset: 0 } })
    expect(leaves(suggester.children as ReturnType<typeof toSlateValue>)[0]).toEqual(['Please ', 'insert'])
    renderer.rejectAllChanges()
    expect(Node.string(suggester.children[0])).toBe('Write 600 words.')
    expect(Node.string(toSlateValue(baseField)[0])).toBe('Write 600 words.')
    expect(binding.check()).toBe(true)
  })
})
