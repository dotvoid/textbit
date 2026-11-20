import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import {
  addItem, between, createContent, fieldIssues, itemsOf, pathOf, projection, resolvePath, toJSON,
  writeField
} from '../lib/model'
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

describe('what a type does not allow', () => {
  it('finds nothing in a document made from its type', () => {
    const doc = new Y.Doc()
    createContent(doc.get('content'), plan.content, initial)
    expect(fieldIssues(doc.get('content'), plan.content)).toEqual([])
  })

  it('finds values of the wrong kind, fields that are not what the type says, and keys', () => {
    const doc = new Y.Doc()
    const content = doc.get('content')
    createContent(content, plan.content, initial)
    content.setAttr('due', 'tomorrow')
    content.setAttr('title', 'a string, not a text field')
    const assignments = content.getAttr('assignments') as Y.Node
    // Two people adding the item `text` at once
    addItem(assignments, plan.content.fields.assignments as never, { id: 'text', status: 'done' })
    const [item] = itemsOf(assignments).filter((candidate) => candidate.getAttr('id') === 'photo')
    item.setAttr('status', 'lost')

    const issues = fieldIssues(content, plan.content)
    expect(issues.map(({ path, code }) => [path.join('.'), code])).toEqual([
      ['title', 'slot'],
      ['due', 'value'],
      ['assignments.#photo.status', 'value'],
      ['assignments.#text', 'key']
    ])
    // The later of the two is the one found
    expect(issues[3].item?.getAttr('status')).toBe('done')
  })

  it('writes a field back from JSON, a text field as a new one', () => {
    const doc = new Y.Doc()
    const content = doc.get('content')
    createContent(content, plan.content, initial)
    content.setAttr('title', 'broken')
    writeField(content, 'title', plan.content.fields.title, [paragraph('t', 'Harbour feature')])
    content.setAttr('due', 'tomorrow')
    writeField(content, 'due', plan.content.fields.due, undefined)
    expect(fieldIssues(content, plan.content)).toEqual([])
    expect(toJSON(content, plan.content)).toMatchObject({
      title: [{ id: 't', children: [{ text: 'Harbour feature' }] }],
      due: undefined
    })
  })
})
