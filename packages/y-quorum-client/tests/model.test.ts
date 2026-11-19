import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { addItem, between, createContent, itemsOf, pathOf, projection, resolvePath, toJSON } from '../lib/model'
import { paragraph, plan } from './_plan'

const initial = {
  title: [paragraph('t', 'Harbour feature')],
  due: '2026-12-01',
  meta: { slug: 'harbour' },
  assignments: [
    { id: 'text', title: [paragraph('a', 'Article')], status: 'todo', description: [paragraph('d', 'Write 600 words.')] },
    { id: 'photo', title: [paragraph('b', 'Photos')], status: 'todo' }
  ]
}

describe('a typed document', () => {
  it('is created from JSON and read back as JSON, on another client too', () => {
    const doc = new Y.Doc()
    createContent(doc.get('content'), plan.content, initial)
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    const json = toJSON(other.get('content'), plan.content)
    expect(json).toMatchObject({
      due: '2026-12-01',
      meta: { slug: 'harbour' },
      title: [{ id: 't', children: [{ text: 'Harbour feature' }] }]
    })
    expect((json.assignments as Array<{ id: string }>).map((a) => a.id)).toEqual(['text', 'photo'])
    expect((json.assignments as Array<{ description: unknown[] }>)[1].description).toEqual([])
  })

  it('names where a change is: down to a text field, through list items by key', () => {
    const doc = new Y.Doc()
    const root = doc.get('content')
    createContent(root, plan.content, initial)
    const description = resolvePath(root, plan.content, ['assignments', '#text', 'description'])!.value as Y.Node
    const block = description.get(0) as Y.Node
    expect(pathOf(block, root, plan.content)).toEqual(['assignments', '#text', 'description'])
    expect(pathOf(description, root, plan.content)).toEqual(['assignments', '#text', 'description'])
    const meta = resolvePath(root, plan.content, ['meta'])!.value as Y.Node
    expect(pathOf(meta, root, plan.content)).toEqual(['meta'])
  })

  it('projects chosen fields for a list', () => {
    const doc = new Y.Doc()
    const root = doc.get('content')
    createContent(root, plan.content, initial)
    expect(projection(root, plan.content, ['due', 'meta.slug'])).toEqual({ due: '2026-12-01', 'meta.slug': 'harbour' })
  })

  it('adds items between others without moving any', () => {
    const doc = new Y.Doc()
    const root = doc.get('content')
    createContent(root, plan.content, initial)
    const list = root.getAttr('assignments') as Y.Node
    const [first, second] = itemsOf(list, plan.content.fields.assignments as never)
    const middle = between(String(first.getAttr('_pos')), String(second.getAttr('_pos')))
    addItem(list, plan.content.fields.assignments as never, { id: 'video', status: 'todo' }, middle)
    expect(itemsOf(list, plan.content.fields.assignments as never).map((i) => i.getAttr('id'))).toEqual(['text', 'video', 'photo'])
  })
})
