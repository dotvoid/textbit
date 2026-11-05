import { describe, test, expect, vi } from 'vitest'
import { act, fireEvent } from '@testing-library/react'
import { Editor, Node, Transforms, type Descendant, type Element } from 'slate'
import { CodeBlock, Link, LocalizedQuotationMarks, OrderedList, Table, Text, UnorderedList } from '../lib'
import { pressKey, renderEditor, settle } from './_editor'

const paragraphs = (...texts: string[]): Descendant[] =>
  texts.map((text, i) => ({ id: `p${i}`, type: 'core/text', class: 'text', properties: {}, children: [{ text }] }))

const types = (editor: Editor) => editor.children.map((n) => (n as Element).type)
const editableOf = (container: HTMLElement) => container.querySelector('[data-slate-editor]') as HTMLElement

describe('lists', () => {
  const plugins = () => [Text(), UnorderedList(), OrderedList()]

  test('toggle a paragraph into a list and back, and switch list type', async () => {
    const { editor, container, run } = renderEditor(plugins(), paragraphs('One'))
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    run('core/unordered-list/toggle')
    await settle()
    expect(types(editor)).toEqual(['core/unordered-list'])
    expect(container.querySelector('ul li')?.textContent).toBe('One')

    run('core/ordered-list/toggle')
    await settle()
    expect(container.querySelector('ol li')?.textContent).toBe('One')

    run('core/ordered-list/toggle')
    expect(types(editor)).toEqual(['core/text'])
  })

  test('Enter on the last item adds an item; on an empty last item leaves the list', async () => {
    const { editor, container } = renderEditor(plugins(), paragraphs('One'))
    const editable = editableOf(container)
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    act(() => {
      Transforms.setNodes(editor, { type: 'core/unordered-list/list-item' })
      Transforms.wrapNodes(editor, { id: 'l', class: 'text', type: 'core/unordered-list', children: [] })
    })
    act(() => Transforms.select(editor, Editor.end(editor, [0, 0])))

    pressKey(editable, 'Enter')
    expect((editor.children[0] as Element).children).toHaveLength(2)

    pressKey(editable, 'Enter')
    expect(types(editor)).toEqual(['core/unordered-list', 'core/text'])
    expect((editor.children[0] as Element).children).toHaveLength(1)
    expect(editor.selection?.anchor.path).toEqual([1, 0])
  })

  test('outside a list, Enter is left alone', () => {
    const enter = UnorderedList().actions!.find((a) => a.name === 'enter')!
    const { editor } = renderEditor(plugins(), paragraphs('One'))
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    expect(enter.when!(editor)).toBe(false)
  })
})

describe('code block and table share Tab', () => {
  const plugins = () => [Text(), CodeBlock(), Table()]

  test('Tab indents in a code block and moves between cells in a table', async () => {
    const { editor, container, run } = renderEditor(plugins(), paragraphs('Hello'))
    const editable = editableOf(container)
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    run('core/code-block/insert')
    run('core/table/insert')
    await settle()
    // Inserting moves the caret into the new block, so the table follows the code block
    expect(types(editor)).toEqual(['core/text', 'core/code-block', 'core/table'])

    // In the code block
    act(() => Transforms.select(editor, Editor.start(editor, [1])))
    pressKey(editable, 'Tab')
    expect(Node.string(editor.children[1])).toBe('  ')

    // In the table: first cell to the second
    act(() => Transforms.select(editor, Editor.start(editor, [2, 0, 0])))
    pressKey(editable, 'Tab')
    expect(editor.selection?.anchor.path.slice(0, 3)).toEqual([2, 0, 1])
    pressKey(editable, 'Tab', { shiftKey: true })
    expect(editor.selection?.anchor.path.slice(0, 3)).toEqual([2, 0, 0])
  })

  test('Tab in the last cell adds a row; Shift+Tab in the first cell stays put', async () => {
    const { editor, container, run } = renderEditor(plugins(), paragraphs('Hello'))
    const editable = editableOf(container)
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    run('core/table/insert')
    await settle()

    act(() => Transforms.select(editor, Editor.start(editor, [1, 1, 1])))
    pressKey(editable, 'Tab')
    expect((editor.children[1] as Element).children).toHaveLength(3)
    expect(editor.selection?.anchor.path.slice(0, 3)).toEqual([1, 2, 0])

    act(() => Transforms.select(editor, Editor.start(editor, [1, 0, 0])))
    pressKey(editable, 'Tab', { shiftKey: true })
    expect(editor.selection?.anchor.path.slice(0, 3)).toEqual([1, 0, 0])
  })

  test('outside both, Tab is left to the browser', () => {
    const { editor } = renderEditor(plugins(), paragraphs('Hello'))
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    const tabActions = [...CodeBlock().actions!, ...Table().actions!].filter((a) => a.hotkey === 'tab')
    expect(tabActions.map((a) => a.when!(editor))).toEqual([false, false])
  })
})

describe('table', () => {
  test('a new table is 2 by 2, or the size asked for', async () => {
    const { editor, run } = renderEditor([Text(), Table({ rows: 3, columns: 4 })], paragraphs('Hello'))
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    run('core/table/insert')
    const table = editor.children[1] as Element
    expect(table.children).toHaveLength(3)
    expect((table.children[0] as Element).children).toHaveLength(4)
  })

  test('row and column actions show with the caret in a cell', () => {
    const rowAbove = Table().actions!.find((a) => a.name === 'row-above')!
    const table = { type: 'core/table' } as Element
    const cell = { type: 'core/table/row/cell' } as Element
    expect(rowAbove.visibility!(table, cell)).toEqual([true, true, false])
    expect(rowAbove.visibility!({ type: 'core/text' } as Element)).toEqual([false, false, false])
  })

  test('rows and columns can be added and removed, never the last one', async () => {
    const { editor, run } = renderEditor([Text(), Table()], paragraphs('Hello'))
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    run('core/table/insert')
    const table = () => editor.children[1] as Element
    const width = () => (table().children[0] as Element).children.length
    act(() => Transforms.select(editor, Editor.start(editor, [1, 0, 0])))

    run('core/table/row-below')
    run('core/table/column-right')
    expect([table().children.length, width()]).toEqual([3, 3])

    run('core/table/delete-row')
    run('core/table/delete-row')
    run('core/table/delete-row')
    run('core/table/delete-column')
    run('core/table/delete-column')
    run('core/table/delete-column')
    expect([table().children.length, width()]).toEqual([1, 1])
  })

  test('the actions do nothing outside a table', () => {
    const { editor, run } = renderEditor([Text(), Table()], paragraphs('Hello'))
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    run('core/table/row-below')
    expect(types(editor)).toEqual(['core/text'])
  })

  test('short rows are padded to the widest', () => {
    const { editor } = renderEditor([Text(), Table()], [{
      id: 't', class: 'block', type: 'core/table', children: [
        { id: 'r1', class: 'block', type: 'core/table/row', children: [
          { id: 'c1', class: 'text', type: 'core/table/row/cell', children: [{ text: 'a' }] },
          { id: 'c2', class: 'text', type: 'core/table/row/cell', children: [{ text: 'b' }] }
        ] },
        { id: 'r2', class: 'block', type: 'core/table/row', children: [
          { id: 'c3', class: 'text', type: 'core/table/row/cell', children: [{ text: 'c' }] }
        ] }
      ]
    } as Descendant])
    act(() => Editor.normalize(editor, { force: true }))
    expect(((editor.children[0] as Element).children[1] as Element).children).toHaveLength(2)
  })
})

describe('link', () => {
  const linked = (href: string): Descendant[] => [{
    id: 'p', type: 'core/text', class: 'text', properties: {}, children: [
      { text: 'See ' },
      { id: 'l', class: 'inline', type: 'core/link', properties: { href }, children: [{ text: 'this' }] },
      { text: '' }
    ]
  } as Descendant]

  test('an unsafe address in a document never becomes a live link', () => {
    const { container } = renderEditor([Text(), Link()], linked('javascript:alert(1)'))
    const a = container.querySelector('a.tb-link')!
    expect(a.hasAttribute('href')).toBe(false)
    expect(a.hasAttribute('data-invalid')).toBe(true)
  })

  test('a safe address does, and Ctrl/⌘-click opens it in a new tab without access back', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { container } = renderEditor([Text(), Link()], linked('https://example.com/'))
    const a = container.querySelector('a.tb-link')!
    expect(a.getAttribute('href')).toBe('https://example.com/')

    fireEvent.click(a, { ctrlKey: true })
    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  test('the action links the selection', async () => {
    vi.useFakeTimers()
    const { editor, container, run } = renderEditor([Text(), Link()], paragraphs('Hello world'))
    act(() => Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 5 } }))
    run('core/link/edit')
    act(() => vi.runAllTimers())
    vi.useRealTimers()
    await settle()
    expect(container.querySelector('a.tb-link')?.textContent).toBe('Hello')
  })

  test('labels can be translated', () => {
    expect(Link({ labels: { title: 'Länk' } }).actions![0].title).toBe('Länk')
    expect(Link().actions![0].hotkey).toBe('mod+k')
    expect(Link({ hotkey: false }).actions![0].hotkey).toBeUndefined()
  })
})

describe('localized quotation marks', () => {
  test('claims typed quotes and hyphens, nothing else', () => {
    const plugin = LocalizedQuotationMarks()
    if (!('consumer' in plugin) || !plugin.consumer) {
      throw new Error('LocalizedQuotationMarks has no consumer')
    }
    const consumes = plugin.consumer.consumes
    const claims = (data: string) => consumes({ input: { source: 'text', type: 'text/plain', data } })[0]
    expect([claims('"'), claims('\''), claims('-'), claims('a')]).toEqual([true, true, true, false])
  })

  test('turns a pair of typed quotes into typographic ones', async () => {
    const { editor } = renderEditor([Text(), LocalizedQuotationMarks()], paragraphs('He said '))
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    for (const ch of ['"', 'h', 'i', '"']) {
      await act(async () => {
        editor.insertText(ch)
      })
    }
    expect(Node.string(editor.children[0])).toBe('He said “hi”')
  })
})
