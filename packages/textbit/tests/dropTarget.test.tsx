import { describe, test, expect, vi } from 'vitest'
import { act, createEvent, fireEvent, render } from '@testing-library/react'
import { createEditor, type Descendant, type Editor, type Element } from 'slate'
import { useSlateStatic, withReact } from 'slate-react'
import { findDropTarget, type DropBlock } from '../lib/utils/dropTarget'
import { pipeFromDrop } from '../lib/utils/pipes'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { DropMarker } from '../lib/components/DropMarker'
import type { PluginDefinition } from '../lib/types'
import { Text } from '../lib/components/core/Text'

// Three blocks, 40px tall, with 20px margins between them
const box = (top: number) => ({ top, bottom: top + 40, left: 0, right: 600 })
const blocks = (droppable = false): DropBlock[] => [0, 60, 120].map((top, at) => ({ at, box: box(top), droppable }))

describe('findDropTarget', () => {
  test('below one block and above the next are the same stop, halfway through the gap', () => {
    const lowInFirst = findDropTarget(blocks(), 35)
    const inGap = findDropTarget(blocks(), 50)
    const highInSecond = findDropTarget(blocks(), 65)

    expect(lowInFirst).toEqual({ index: 1, line: { top: 50, left: 0, width: 600 } })
    expect(inGap).toEqual(lowInFirst)
    expect(highInSecond).toEqual(lowInFirst)
  })

  test('each drop position has exactly one place for its line, wherever the pointer is', () => {
    const tops = new Map<number, Set<number>>()
    for (let y = -20; y <= 200; y++) {
      const { index, line } = findDropTarget(blocks(), y)
      tops.set(index, (tops.get(index) ?? new Set()).add(line!.top))
    }

    expect([...tops.keys()].sort()).toEqual([0, 1, 2, 3])
    expect([...tops.values()].map((s) => [...s])).toEqual(expect.arrayContaining([[0], [50], [110], [160]]))
    expect([...tops.values()].every((s) => s.size === 1)).toBe(true)
  })

  test('above the first block and below the last', () => {
    expect(findDropTarget(blocks(), -10)).toMatchObject({ index: 0, line: { top: 0 } })
    expect(findDropTarget(blocks(), 500)).toMatchObject({ index: 3, line: { top: 160 } })
  })

  test('a block that takes drops onto itself is outlined when the pointer is over its middle', () => {
    expect(findDropTarget(blocks(true), 70)).toEqual({ index: 1, around: box(60) })
    expect(findDropTarget(blocks(true), 90)).toEqual({ index: 2, around: box(60) })
    // Its edges still drop between blocks
    expect(findDropTarget(blocks(true), 63)).toMatchObject({ index: 1, line: { top: 50 } })
  })

  test('a block that is not rendered keeps the others at their document index', () => {
    const rendered = [{ at: 0, box: box(0), droppable: false }, { at: 2, box: box(60), droppable: false }]
    expect(findDropTarget(rendered, 50).index).toBe(2)
    expect(findDropTarget(rendered, 500).index).toBe(3)
  })

  test('an empty editor drops at the start', () => {
    expect(findDropTarget([], 10)).toEqual({ index: 0 })
  })
})

describe('moving a block by dragging it', () => {
  function editorWith(ids: string[]): Editor {
    const editor = withReact(createEditor())
    editor.children = ids.map((id) => ({
      id, type: 'base/text', class: 'text', properties: {}, children: [{ text: id }]
    }) as Descendant)
    return editor
  }

  function drop(editor: Editor, id: string, at: number) {
    const dataTransfer = {
      types: ['textbit/droppable-id'],
      items: [{ kind: 'string', type: 'textbit/droppable-id' }],
      getData: (type: string) => type === 'textbit/droppable-id' ? id : '',
      files: []
    } as unknown as DataTransfer
    const event = { dataTransfer, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as React.DragEvent
    pipeFromDrop(editor, [], event, at)
  }

  const order = (editor: Editor) => editor.children.map((n) => (n as Element).id)

  test('down: lands at the marker, not one block further', () => {
    const editor = editorWith(['a', 'b', 'c'])
    drop(editor, 'a', 2)
    expect(order(editor)).toEqual(['b', 'a', 'c'])
  })

  test('to the end', () => {
    const editor = editorWith(['a', 'b', 'c'])
    drop(editor, 'a', 3)
    expect(order(editor)).toEqual(['b', 'c', 'a'])
  })

  test('up', () => {
    const editor = editorWith(['a', 'b', 'c'])
    drop(editor, 'c', 0)
    expect(order(editor)).toEqual(['c', 'a', 'b'])
  })

  test('onto either side of itself: nothing moves', () => {
    const editor = editorWith(['a', 'b', 'c'])
    drop(editor, 'b', 1)
    drop(editor, 'b', 2)
    expect(order(editor)).toEqual(['a', 'b', 'c'])
  })
})

describe('dropping in the editor', () => {
  const content: Descendant[] = ['one', 'two', 'three'].map((id) => ({
    id, type: 'base/text', class: 'text', properties: {}, children: [{ text: id }]
  }) as Descendant)

  // jsdom has no layout: give each block the box of blocks() by its id
  function layout() {
    const tops: Record<string, number> = { one: 0, two: 60, three: 120 }
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // Only the block node, not the drag wrapper around it with the same id
      const id = this.matches('[data-slate-node="element"]') ? this.getAttribute('data-id') : null
      const top = tops[id ?? '']
      const r = top === undefined ? { top: 0, bottom: 0, left: 0, right: 0 } : box(top)
      return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r } as DOMRect
    })
  }

  // jsdom has no DragEvent, so the event it makes carries no clientY
  function drag(type: 'dragEnter' | 'dragOver' | 'drop', el: HTMLElement, clientY: number, init: object = {}) {
    const event = createEvent[type](el, init)
    Object.defineProperty(event, 'clientY', { value: clientY })
    fireEvent(el, event)
  }

  function setup(plugins: PluginDefinition[] = []) {
    let editor: Editor | undefined
    function Capture() {
      editor = useSlateStatic()
      return null
    }
    const result = render(
      <TextbitRoot value={content} onChange={() => {}} plugins={[Text(), ...plugins]}>
        <TextbitEditable>
          <Capture />
          <DropMarker />
        </TextbitEditable>
      </TextbitRoot>
    )
    const editable = result.container.querySelector('[data-slate-editor]') as HTMLElement
    return { editor: editor!, editable, marker: result.container.querySelector('[data-dragover]') as HTMLElement }
  }

  test('dragging over a gap between blocks shows the marker there', () => {
    const spy = layout()
    const { editable, marker } = setup()

    act(() => {
      drag('dragEnter', editable, 50)
      drag('dragOver', editable, 50)
    })

    expect(marker.dataset.dragover).toBe('between')
    expect(marker.style.display).toBe('block')
    // Halfway between the first block (ends at 40) and the second (starts at 60)
    expect(marker.style.top).toBe('50px')
    expect(marker.style.transform).toBe('translateY(-50%)')
    spy.mockRestore()
  })

  test('a drop in a gap goes where the marker showed', async () => {
    const spy = layout()
    const consume = vi.fn(async () => ({
      source: 'drop',
      type: 'test/thing',
      data: { id: 'new', type: 'test/thing', class: 'block', properties: {}, children: [{ text: '' }] } as Element
    }))
    const plugins: PluginDefinition[] = [{
      class: 'block',
      name: 'test/thing',
      componentEntry: { class: 'block', component: ({ children }) => <div>{children}</div> },
      consumer: { consumes: () => [true, 'test/thing', false], consume }
    }]
    const { editor, editable } = setup(plugins)
    const file = new File(['x'], 'x.txt', { type: 'text/x-thing' })
    const dataTransfer = {
      types: ['Files'],
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      files: [file],
      getData: () => ''
    }

    await act(async () => {
      drag('drop', editable, 50, { dataTransfer })
      await new Promise((resolve) => setTimeout(resolve))
    })

    expect(consume).toHaveBeenCalled()
    expect(editor.children.map((n) => (n as Element).id)).toEqual(['one', 'new', 'two', 'three'])
    spy.mockRestore()
  })
})
