import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { Node, Transforms } from 'slate'
import { bindField } from '../src/binding.ts'
import { comparable, seedField, toSlateValue } from '../src/model.ts'
import {
  addItem,
  between,
  createPlan,
  findItem,
  itemsOf,
  listOf,
  orderedItems,
  projection,
  removeCopies,
  textField
} from '../src/tree.ts'
import { makeEditor, Network } from './helpers.ts'

function twoClients({ live = true } = {}) {
  const network = new Network({ live })
  const a = network.add(new Y.Doc())
  const root = createPlan(a, { due: '2026-12-01' })
  seedField(textField(root, 'title'), [{ id: 't', type: 'core/text', class: 'text', children: [{ text: 'Harbour feature' }] }])
  const list = listOf(root, 'assignments')
  addItem(list, { id: 'photo', pos: 'b', status: 'todo' })
  addItem(list, { id: 'text', pos: 'm', status: 'todo' })
  seedField(textField(findItem(list, 'text')!, 'description'), [
    { id: 'd1', type: 'core/text', class: 'text', children: [{ text: 'Write 600 words about winter.' }] }
  ])
  const b = network.add(new Y.Doc())
  return { network, a, b, rootA: root, rootB: b.get('content') }
}

describe('a typed document tree', () => {
  it('binds editors to text fields anywhere in it', () => {
    const { rootA, rootB } = twoClients()
    const listB = listOf(rootB, 'assignments')
    const description = makeEditor()
    const descriptionBinding = bindField(description, textField(findItem(listB, 'text')!, 'description'))
    const title = makeEditor()
    bindField(title, textField(rootA, 'title'))
    Transforms.insertText(description, 'Short: ', { at: { path: [0, 0], offset: 0 } })
    Transforms.insertText(title, 'Winter ', { at: { path: [0, 0], offset: 0 } })
    expect(descriptionBinding.check()).toBe(true)
    const descriptionA = textField(findItem(listOf(rootA, 'assignments'), 'text')!, 'description')
    expect(Node.string(toSlateValue(descriptionA)[0])).toBe('Short: Write 600 words about winter.')
    expect(projection(rootB, ['title', 'due'])).toEqual({ title: 'Winter Harbour feature', due: '2026-12-01' })
  })

  it('ends with one value when two people set a single value at once', () => {
    const { network, rootA, rootB } = twoClients({ live: false })
    network.flush()
    findItem(listOf(rootA, 'assignments'), 'photo')!.setAttr('status', 'doing')
    findItem(listOf(rootB, 'assignments'), 'photo')!.setAttr('status', 'done')
    network.flush()
    const a = findItem(listOf(rootA, 'assignments'), 'photo')!.getAttr('status')
    const b = findItem(listOf(rootB, 'assignments'), 'photo')!.getAttr('status')
    expect(a).toBe(b)
    expect(['doing', 'done']).toContain(a)
  })

  it('reorders items by position, keeping anchors in their text', () => {
    const { a, rootA } = twoClients()
    const list = listOf(rootA, 'assignments')
    const description = textField(findItem(list, 'text')!, 'description')
    const anchor = Y.createRelativePositionFromTypeIndex(description.get(0) as Y.Node, 6) // "Write |600"
    // Move "text" before "photo": only its position changes
    findItem(list, 'text')!.setAttr('pos', between(undefined, 'b'))
    expect(orderedItems(list).map((item) => item.getAttr('id'))).toEqual(['text', 'photo'])
    const resolved = Y.createAbsolutePositionFromRelativePosition(anchor, a)
    expect(resolved?.index).toBe(6)
  })

  it('loses anchors when an item is moved by deleting and inserting it', () => {
    const { a, rootA } = twoClients()
    const list = listOf(rootA, 'assignments')
    const item = findItem(list, 'text')!
    const description = textField(item, 'description')
    const anchor = Y.createRelativePositionFromTypeIndex(description.get(0) as Y.Node, 6)
    const copy = toSlateValue(description)
    const index = itemsOf(list).indexOf(item)
    a.transact(() => {
      list.applyDelta(delta.create().retain(index).delete(1).done())
      addItem(list, { id: 'text', pos: 'a', status: 'todo' })
      seedField(textField(findItem(list, 'text')!, 'description'), copy)
    })
    const resolved = Y.createAbsolutePositionFromRelativePosition(anchor, a)
    const stillInTheItem = resolved?.type === (textField(findItem(list, 'text')!, 'description').get(0) as Y.Node)
    expect(stillInTheItem).toBe(false)
  })

  it('keeps one of two items added with the same id, when only the owner removes copies', () => {
    const { network, rootA, rootB } = twoClients({ live: false })
    network.flush()
    addItem(listOf(rootA, 'assignments'), { id: 'video', pos: 'x', status: 'todo' })
    addItem(listOf(rootB, 'assignments'), { id: 'video', pos: 'y', status: 'todo' })
    network.flush()
    expect(itemsOf(listOf(rootA, 'assignments')).filter((i) => i.getAttr('id') === 'video')).toHaveLength(2)
    // A is the owner
    expect(removeCopies(listOf(rootA, 'assignments'))).toBe(1)
    network.flush()
    for (const root of [rootA, rootB]) {
      expect(itemsOf(listOf(root, 'assignments')).filter((i) => i.getAttr('id') === 'video')).toHaveLength(1)
    }
    expect(findItem(listOf(rootA, 'assignments'), 'video')!.getAttr('pos'))
      .toBe(findItem(listOf(rootB, 'assignments'), 'video')!.getAttr('pos'))
  })

  it('loses one person’s text when two create the same text field at once', () => {
    const { network, rootA, rootB } = twoClients({ live: false })
    network.flush()
    // A field created lazily by whoever types first, on two clients at once
    rootA.setAttr('summary', new Y.Node('text'))
    seedField(textField(rootA, 'summary'), [{ id: 's1', type: 'core/text', class: 'text', children: [{ text: 'From A' }] }])
    rootB.setAttr('summary', new Y.Node('text'))
    seedField(textField(rootB, 'summary'), [{ id: 's2', type: 'core/text', class: 'text', children: [{ text: 'From B' }] }])
    network.flush()
    const a = comparable(toSlateValue(textField(rootA, 'summary')))
    expect(a).toBe(comparable(toSlateValue(textField(rootB, 'summary'))))
    expect(a.includes('From A') && a.includes('From B')).toBe(false)
  })
})

describe('positions', () => {
  it('fit between any two, and at either end', () => {
    let positions = ['m']
    for (let i = 0; i < 200; i++) {
      const at = i % 3
      const sorted = [...positions].sort()
      const index = at === 0 ? 0 : at === 1 ? sorted.length : Math.floor(sorted.length / 2)
      const next = between(sorted[index - 1], sorted[index])
      expect(sorted[index - 1] === undefined || sorted[index - 1] < next).toBe(true)
      expect(sorted[index] === undefined || next < sorted[index]).toBe(true)
      positions = [...positions, next]
    }
  })
})
