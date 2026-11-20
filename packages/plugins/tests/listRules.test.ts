// @vitest-environment node
// Lists keep to their place: only paragraphs become a list, and a list left
// without items goes, a list item left outside its list becomes a paragraph
import { describe, test, expect } from 'vitest'
import { Editor, Transforms, type Descendant } from 'slate'
import { createTextbitEditor, validate } from '@dotvoid/textbit/headless'
import { Blockquote, OrderedList, Text, UnorderedList } from '../lib/definitions'

const plugins = [Text(), Blockquote(), UnorderedList(), OrderedList()]

const p = (id: string, text: string): Descendant =>
  ({ id, class: 'text', type: 'base/text', children: [{ text }] }) as Descendant

const quote = {
  id: 'q', class: 'block', type: 'base/blockquote', children: [
    { id: 'qb', class: 'text', type: 'base/blockquote/body', children: [{ text: 'Quoted' }] },
    { id: 'qc', class: 'text', type: 'base/blockquote/citation', children: [{ text: 'Someone' }] }
  ]
} as Descendant

const toggle = (editor: Editor) => UnorderedList().actions!
  .find((action) => action.name === 'toggle')!.handler({ editor } as never)

describe('lists', () => {
  test('leave a quote alone when the selection reaches into it', () => {
    const editor = createTextbitEditor({ plugins, value: [p('a', 'One'), quote] })
    Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [1, 0, 0], offset: 3 }
    })
    toggle(editor)
    expect(editor.children).toEqual([p('a', 'One'), quote])
  })

  test('still make paragraphs a list', () => {
    const editor = createTextbitEditor({ plugins, value: [p('a', 'One'), p('b', 'Two')] })
    Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [1, 0], offset: 3 }
    })
    toggle(editor)
    expect(editor.children).toMatchObject([{
      type: 'base/unordered-list',
      children: [
        { id: 'a', type: 'base/unordered-list/list-item' },
        { id: 'b', type: 'base/unordered-list/list-item' }
      ]
    }])
    const errors = validate(editor.children, plugins).filter((issue) => issue.severity === 'error')
    expect(errors).toEqual([])
  })

  test('go when nothing is left in them but an empty text', () => {
    const emptied = {
      id: 'l', class: 'text', type: 'base/unordered-list', children: [{ text: '' }]
    } as Descendant
    const editor = createTextbitEditor({ plugins, value: [p('a', 'One'), emptied] })
    Editor.normalize(editor, { force: true })
    expect(editor.children).toEqual([p('a', 'One')])
  })

  test('leave an item standing alone at the top level a paragraph, with its text', () => {
    const item = {
      id: 'i', class: 'text', type: 'base/unordered-list/list-item', children: [{ text: 'Alone' }]
    }
    const editor = createTextbitEditor({ plugins, value: [p('a', 'One'), item as Descendant] })
    Editor.normalize(editor, { force: true })
    expect(editor.children).toEqual([p('a', 'One'), { ...p('i', 'Alone'), properties: {} }])
  })
})
