import { describe, test, expect, afterEach, beforeAll, vi } from 'vitest'
import { act, createEvent, fireEvent, render } from '@testing-library/react'
import { Transforms, type Descendant, type Editor } from 'slate'
import { useSlateStatic } from 'slate-react'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { Text } from '../lib/components/core/Text'
import { handleBlockSelectionKeyDown } from '../lib/components/TextbitEditable/handleOnKeyDown/blockSelectionHandler'
import type { PluginDefinition } from '../lib/types'

// slate-react only handles events whose target is editable, which it checks
// with isContentEditable. jsdom does not implement it.
Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
  configurable: true,
  get(this: HTMLElement) {
    return this.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true'
  }
})

// The shared test setup stubs window.getSelection with an empty selection.
// These tests are about the browser's selection, so they use jsdom's own.
beforeAll(() => {
  window.getSelection = () => document.getSelection()
})

// A void block with an input in it, like an image's settings
const Picture: PluginDefinition = {
  class: 'block',
  name: 'test/picture',
  componentEntry: {
    class: 'block',
    component: ({ children }) => <figure>{children}</figure>,
    children: [{
      type: 'content',
      class: 'void',
      component: ({ children }) => <><div contentEditable={false}><input aria-label='Setting' defaultValue='abc' /></div>{children}</>
    }]
  }
}

const content: Descendant[] = [
  { id: 'a', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Hello world' }] },
  { id: 'b', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Second' }] },
  {
    id: 'pic', type: 'test/picture', class: 'block', properties: {}, children: [
      { id: 'c', type: 'test/picture/content', class: 'void', children: [{ text: '' }] }
    ]
  }
] as Descendant[]

function setup() {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const { container } = render(
    <>
      <TextbitRoot value={content} onChange={() => {}} plugins={[Text(), Picture]}>
        <TextbitEditable><Capture /></TextbitEditable>
      </TextbitRoot>
    </>
  )
  // As when someone copies: focus is in the editor
  const editable = container.querySelector<HTMLElement>('[data-slate-editor]')!
  act(() => editable.focus())
  const text = (id: string) => container.querySelector(`[data-id="${id}"][data-slate-node="element"] [data-slate-string]`)!.firstChild!
  return { editor: editor!, container, text }
}

/** A clipboard event as the browser sends it, with a clipboard to write to */
function clipboard(type: 'copy' | 'cut', target: globalThis.Node) {
  const data = new Map<string, string>()
  const clipboardData = {
    setData: (format: string, value: string) => data.set(format, value),
    getData: (format: string) => data.get(format) ?? '',
    types: [] as string[]
  }
  const element = target instanceof Element ? target : target.parentElement!
  const event = createEvent[type](element, { clipboardData })
  act(() => {
    fireEvent(element, event)
  })
  return { text: data.get('text/plain'), prevented: event.defaultPrevented }
}

// The browser's selection, changed without slate-react hearing of it yet
function select(anchor: globalThis.Node, anchorOffset: number, focus: globalThis.Node, focusOffset: number) {
  window.getSelection()!.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
}

afterEach(() => {
  window.getSelection()!.removeAllRanges()
})

// Copy and cut taking a selection made just before them is slate-react's job
// since 0.147.6 (ianstormtaylor/slate#6364), tested there in real browsers.
describe('copy and cut', () => {
  test('without a browser selection, editor.selection is used as before', () => {
    const { editor, text } = setup()
    act(() => Transforms.select(editor, { anchor: { path: [1, 0], offset: 0 }, focus: { path: [1, 0], offset: 3 } }))
    window.getSelection()!.removeAllRanges()

    expect(clipboard('copy', text('b')).text).toBe('Sec')
  })
})

describe('left to the browser', () => {
  test('a copy in an input inside a void block', () => {
    const { editor, container, text } = setup()
    act(() => Transforms.select(editor, { path: [0, 0], offset: 1 }))
    select(text('b'), 0, text('b'), 3)

    const result = clipboard('copy', container.querySelector('input')!)
    expect(result.prevented).toBe(false)
    expect(editor.selection?.anchor).toEqual({ path: [0, 0], offset: 1 })
  })
})

describe('copy and paste shortcuts with blocks selected', () => {
  function press(init: { key: string, shiftKey?: boolean }) {
    const { editor } = setup()
    const preventDefault = vi.fn()
    const event = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...init, preventDefault } as unknown as React.KeyboardEvent<HTMLDivElement>
    handleBlockSelectionKeyDown(editor, event, { anchorIndex: 0, focusIndex: 1 }, () => {}, () => {})
    return { editor, prevented: preventDefault.mock.calls.length > 0 }
  }

  test.each([
    ['Caps Lock: C', { key: 'C' }],
    ['Caps Lock: V', { key: 'V' }],
    ['Shift+V, paste as plain text', { key: 'V', shiftKey: true }],
    ['Shift+C', { key: 'C', shiftKey: true }]
  ])('%s reaches the browser', (_label, init) => {
    expect(press(init).prevented).toBe(false)
  })

  test('Shift+X is not a cut', () => {
    const { editor } = press({ key: 'X', shiftKey: true })
    expect(editor.children).toHaveLength(3)
  })
})
