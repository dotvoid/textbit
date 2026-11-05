import { describe, test, expect } from 'vitest'
import type { Descendant } from 'slate'
import { Audio, Blockquote, Image, OrderedList, Table, Text, UnorderedList, audioNode, imageNode } from '../lib'
import { renderEditor } from './_editor'

const cell = (t: string) => ({ id: crypto.randomUUID(), type: 'core/table/row/cell', class: 'text', children: [{ text: t }] })

const doc: Descendant[] = [
  { id: 'ul', type: 'core/unordered-list', class: 'text', children: [
    { id: 'li', type: 'core/unordered-list/list-item', class: 'text', children: [{ text: 'One' }] }
  ] },
  { id: 'ol', type: 'core/ordered-list', class: 'text', children: [
    { id: 'li2', type: 'core/ordered-list/list-item', class: 'text', children: [{ text: 'Two' }] }
  ] },
  { id: 't', type: 'core/table', class: 'block', children: [
    { id: 'r', type: 'core/table/row', class: 'block', children: [cell('a'), cell('b')] }
  ] },
  imageNode({ src: 'https://example.com/a.jpg', alt: 'A' }, 'Caption'),
  audioNode({ src: 'https://example.com/a.mp3' }, 'Caption'),
  { id: 'q', type: 'core/blockquote', class: 'block', children: [
    { id: 'qb', type: 'core/blockquote/body', class: 'text', children: [{ text: 'Quote' }] },
    { id: 'qc', type: 'core/blockquote/citation', class: 'text', children: [{ text: 'Source' }] }
  ] }
] as Descendant[]

describe('valid HTML structure', () => {
  // Core wraps child elements in a <div> unless they render themselves. Inside a
  // table, a list or a figure that wrapper is invalid HTML and breaks layout.
  const render = () => renderEditor(
    [Text(), UnorderedList(), OrderedList(), Table(), Image(), Audio(), Blockquote()],
    doc
  ).container
  const parents = (selector: string) => [...render().querySelectorAll(selector)].map((n) => n.parentElement?.tagName)

  test('list items sit directly in their list', () => {
    expect(parents('li')).toEqual(['UL', 'OL'])
  })

  test('rows sit in tbody, cells in rows', () => {
    expect(parents('tr')).toEqual(['TBODY'])
    expect(parents('td')).toEqual(['TR', 'TR'])
  })

  test('captions sit directly in their figure', () => {
    expect(parents('figcaption')).toEqual(['FIGURE', 'FIGURE', 'FIGURE'])
  })

  test('the elements still carry the editor\'s attributes', () => {
    const td = render().querySelector('td')!
    expect(td.getAttribute('data-slate-node')).toBe('element')
    expect(td.getAttribute('data-type')).toBe('core/table/row/cell')
  })
})
