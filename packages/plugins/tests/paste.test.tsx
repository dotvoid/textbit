import { describe, test, expect } from 'vitest'
import { act } from '@testing-library/react'
import { Node, Transforms, type Descendant, type Element } from 'slate'
import { Blockquote, CodeBlock, Table, Text, UnorderedList } from '../lib'
import { renderEditor, settle } from './_editor'

const plain = (text: string) => ({
  types: ['text/plain'],
  getData: (type: string) => type === 'text/plain' ? text : '',
  files: [],
  items: []
}) as unknown as DataTransfer

async function paste(value: Descendant[], at: number[], text = 'one\ntwo\nthree') {
  const { editor } = renderEditor([Text(), UnorderedList(), CodeBlock(), Table(), Blockquote()], value)
  act(() => Transforms.select(editor, { path: at, offset: 5 }))
  act(() => editor.insertData(plain(text)))
  await settle()
  return editor
}

const texts = (nodes: Descendant[]): string[] => nodes.flatMap((n) => {
  const e = n as Element
  return e.children.some((c) => 'type' in c) ? texts(e.children) : [Node.string(e)]
})

const block = (type: string, children: Descendant[]) => ({ id: type, type, class: 'block', children }) as Descendant
const text = (type: string, t: string) => ({ id: `${type}-${t}`, type, class: 'text', properties: {}, children: [{ text: t }] }) as Descendant

describe('pasting several lines of plain text', () => {
  test('into a paragraph makes a paragraph per line', async () => {
    const editor = await paste([text('base/text', 'Hello world')], [0, 0])
    expect(texts(editor.children)).toEqual(['Helloone', 'two', 'three world'])
  })

  test('into a list item makes a list item per line', async () => {
    const editor = await paste([block('base/unordered-list', [text('base/unordered-list/list-item', 'Hello world')])], [0, 0, 0])
    expect(texts(editor.children)).toEqual(['Helloone', 'two', 'three world'])
  })

  test('into a code block keeps every line, inside it', async () => {
    const editor = await paste([block('base/code-block', [text('base/code-block/body', 'Hello world')])], [0, 0, 0])
    expect(texts(editor.children)).toEqual(['Helloone\ntwo\nthree world'])
    expect(editor.selection?.anchor).toEqual({ path: [0, 0, 0], offset: 18 })
  })

  test('into a quote keeps every line, inside it', async () => {
    const editor = await paste([block('base/blockquote', [
      text('base/blockquote/body', 'Hello world'),
      text('base/blockquote/citation', 'Source')
    ])], [0, 0, 0])
    expect(texts(editor.children)).toEqual(['Helloone\ntwo\nthree world', 'Source'])
  })

  test('into a single line field joins the lines, losing nothing', async () => {
    const editor = await paste([block('base/blockquote', [
      text('base/blockquote/body', 'Quote'),
      text('base/blockquote/citation', 'Hello world')
    ])], [0, 1, 0])
    expect(texts(editor.children)).toEqual(['Quote', 'Helloone two three world'])
  })

  test('Windows line breaks become plain newlines', async () => {
    const editor = await paste([block('base/code-block', [text('base/code-block/body', 'Hello world')])], [0, 0, 0], 'one\r\ntwo')
    expect(texts(editor.children)).toEqual(['Helloone\ntwo world'])
  })
})
