import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { LiveAttributionsRenderer, attributionsOf, emptyAttributions } from '../lib/model'
import type { Person } from '../lib/protocol'

const alice: Person = { kind: 'person', id: 'alice', name: 'Alice' }
const copy: Person = { kind: 'agent', id: 'copy', name: 'Copy editor' }

// A change made to a document, with what its transaction inserted and deleted
function change(doc: Y.Doc, edit: () => void) {
  let sets: { inserts: Y.IdSet, deletes: Y.IdSet } | undefined
  const capture = (tr: { insertSet: Y.IdSet, deleteSet: Y.IdSet }) => {
    sets = { inserts: tr.insertSet, deletes: tr.deleteSet }
  }
  doc.on('afterTransaction', capture)
  doc.transact(edit)
  doc.off('afterTransaction', capture)
  return sets!
}

const runs = (node: Y.Node, renderer: Y.AttributionsRenderer) => node.toDelta({ renderer }).children
  .map((op) => [(op as { insert: string }).insert, (op as { attribution?: Record<string, unknown> }).attribution])

describe('attributions', () => {
  it('say who wrote each piece of text, and follow later changes', () => {
    const doc = new Y.Doc()
    const text = doc.get('content')
    const first = change(doc, () => text.insert(0, 'The harbour.'))
    const renderer = new LiveAttributionsRenderer(attributionsOf(first.inserts, first.deletes, { by: alice, at: 1 }))

    const second = change(doc, () => text.insert(4, 'old '))
    const changed: Y.IdSet[] = []
    renderer.on('change', (ids) => changed.push(ids))
    renderer.add(attributionsOf(second.inserts, second.deletes, { by: copy, onBehalfOf: alice, run: 'r1', at: 2 }))

    expect(changed).toHaveLength(1)
    expect(runs(text, renderer)).toEqual([
      ['The ', { insert: ['person:alice'], insertAt: 1 }],
      ['old ', { insert: ['agent:copy'], insertAt: 2, 'insert:onBehalfOf': 'person:alice', 'insert:run': 'r1' }],
      ['harbour.', { insert: ['person:alice'], insertAt: 1 }]
    ])
  })

  it('leave deleted text out, unless asked to show it', () => {
    const doc = new Y.Doc({ gc: false })
    const text = doc.get('content')
    const first = change(doc, () => text.insert(0, 'The old harbour.'))
    const removal = change(doc, () => text.delete(4, 4))
    const all = Y.mergeContentMaps([
      attributionsOf(first.inserts, first.deletes, { by: alice, at: 1 }),
      attributionsOf(removal.inserts, removal.deletes, { by: copy, at: 2 })
    ])

    expect(runs(text, new LiveAttributionsRenderer(all)).map(([insert]) => insert).join('')).toBe('The harbour.')
    expect(runs(text, new LiveAttributionsRenderer(all, { withDeleted: true }))[1]).toEqual(
      // Deleted text keeps when it was written, beside who deleted it
      ['old ', { delete: ['agent:copy'], deleteAt: 2, insertAt: 1 }]
    )
    expect(emptyAttributions().inserts).toBeDefined()
  })

  it('take text deleted later out of the view', () => {
    const doc = new Y.Doc({ gc: false })
    const text = doc.get('content')
    const first = change(doc, () => text.insert(0, 'The old harbour.'))
    const renderer = new LiveAttributionsRenderer(attributionsOf(first.inserts, first.deletes, { by: alice, at: 1 }))
    const removal = change(doc, () => text.delete(4, 4))
    renderer.add(attributionsOf(removal.inserts, removal.deletes, { by: copy, at: 2 }))

    expect(runs(text, renderer)).toEqual([['The harbour.', { insert: ['person:alice'], insertAt: 1 }]])
  })
})
