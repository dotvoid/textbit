import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import * as Y from '@y/y'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { seedField, fieldToValue, BY_MARK, AT_MARK } from '../lib/yjs/model'

// The text of a field, written by Alice and then partly by Bob, with Y.js 14's
// attributions of who wrote what
function attributed() {
  const doc = new Y.Doc()
  const field = doc.get('body')
  const write = (who: string, at: number, edit: () => void) => {
    let ids: Y.ContentIds | undefined
    const capture = (tr: { insertSet: Y.IdSet, deleteSet: Y.IdSet }) => {
      ids = Y.createContentIds(tr.insertSet, tr.deleteSet)
    }
    doc.on('afterTransaction', capture)
    doc.transact(edit)
    doc.off('afterTransaction', capture)
    return Y.createContentMapFromContentIds(ids!, [
      Y.createContentAttribute('insert', who), Y.createContentAttribute('insertAt', at)
    ], [Y.createContentAttribute('delete', who), Y.createContentAttribute('deleteAt', at)])
  }
  const first = write('person:alice', 1, () => seedField(field, [
    { id: 'p', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'The harbour.' }] }
  ]))
  const second = write('person:bob', 2, () => (field.get(0) as Y.Node).insert(4, 'old '))
  return { field, attributions: Y.mergeContentMaps([first, second]) }
}

describe('text shown with attributions', () => {
  test('carries who wrote each piece, and when, as marks shown only', () => {
    const { field, attributions } = attributed()
    const [paragraph] = fieldToValue(field, Y.createAttributionsRenderer(attributions)) as Array<{ children: Array<Record<string, unknown>> }>

    expect(paragraph.children.map((leaf) => [leaf.text, leaf[BY_MARK], leaf[AT_MARK]])).toEqual([
      ['The ', 'person:alice', 1],
      ['old ', 'person:bob', 2],
      ['harbour.', 'person:alice', 1]
    ])
    // Without a renderer, nothing of it
    expect((fieldToValue(field) as Array<{ children: Array<Record<string, unknown>> }>)[0].children).toEqual([{ text: 'The old harbour.' }])
  })

  test('renders it on the text, for a host to colour by', () => {
    const { field, attributions } = attributed()
    const { container } = render(
      <TextbitRoot value={field} renderer={Y.createAttributionsRenderer(attributions)}>
        <TextbitEditable aria-label='Text' />
      </TextbitRoot>
    )
    const pieces = [...container.querySelectorAll('[data-tb-by]')].map((leaf) => [leaf.textContent, leaf.getAttribute('data-tb-by')])
    expect(pieces).toEqual([['The ', 'person:alice'], ['old ', 'person:bob'], ['harbour.', 'person:alice']])
  })
})
