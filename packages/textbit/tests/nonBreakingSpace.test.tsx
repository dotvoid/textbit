import { describe, test, expect, vi, afterEach, beforeAll, afterAll } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { NonBreakingSpace } from '../lib/components/core/NonBreakingSpace'
import { StandardPlugins } from '../lib/components/core'
import type { PluginDefinition } from '../lib/types'
import { handleOnKeyDown } from '../lib/components/TextbitEditable/handleOnKeyDown/handleOnKeyDown'
import { registerActions } from '../lib/contexts/PluginRegistry/lib/registerAction'
import { adjacentBlockContent } from './_fixtures'

const NBSP = String.fromCharCode(0xa0)

// What a browser reports for Ctrl+Shift+Space: `which` is what is-hotkey matches on.
const ctrlShiftSpace = { key: ' ', code: 'Space', keyCode: 32, which: 32, ctrlKey: true, shiftKey: true }

function makeEditor(content: Descendant[] = [
  { id: 'a', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'ab' }] }
], plugins?: PluginDefinition[]) {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const { container } = render(
    <TextbitRoot value={content} onChange={() => {}} plugins={plugins}>
      <TextbitEditable><Capture /></TextbitEditable>
    </TextbitRoot>
  )
  const editable = container.querySelector('[data-slate-editor]') as HTMLElement
  return { editor: editor!, editable, container }
}

function pressCtrlShiftSpace(editable: HTMLElement, init: Partial<typeof ctrlShiftSpace> = {}) {
  let notPrevented = true
  act(() => {
    notPrevented = fireEvent.keyDown(editable, { ...ctrlShiftSpace, ...init })
  })
  return { prevented: !notPrevented }
}

const text = (editor: Editor, index = 0) => Node.string(editor.children[index])

function asMac() {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
}

// slate-react only handles keys whose target is editable, and checks that with
// isContentEditable, which jsdom does not implement. Without it every keydown
// below would be dropped before reaching textbit at all.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) {
      return this.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true'
    }
  })
})

afterAll(() => {
  delete (HTMLElement.prototype as { isContentEditable?: boolean }).isContentEditable
})

afterEach(() => {
  // Drop the own-property override so the prototype getter applies again
  delete (navigator as { platform?: string }).platform
})

describe('Ctrl+Shift+Space - non-breaking space', () => {
  test('inserts a non-breaking space at the caret and stops the browser default', () => {
    const { editor, editable } = makeEditor()
    act(() => Transforms.select(editor, { path: [0, 0], offset: 1 }))

    const { prevented } = pressCtrlShiftSpace(editable)

    expect(text(editor)).toBe(`a${NBSP}b`)
    // Without this the browser may type a regular space as well
    expect(prevented).toBe(true)
  })

  test('replaces a selection, the same as typing does', () => {
    const { editor, editable } = makeEditor([
      { id: 'a', type: 'core/text', class: 'text', properties: {}, children: [{ text: '10 kr' }] }
    ])
    act(() => Transforms.select(editor, {
      anchor: { path: [0, 0], offset: 2 },
      focus: { path: [0, 0], offset: 3 }
    }))

    pressCtrlShiftSpace(editable)

    expect(text(editor)).toBe(`10${NBSP}kr`)
  })

  test('shows the inserted space with the non-breaking space marker', async () => {
    const { editor, editable, container } = makeEditor()
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    pressCtrlShiftSpace(editable)
    // Slate flushes onChange, and with it the re-render, in a microtask
    await act(async () => {})

    expect(container.querySelector('.tb-nbsp')?.textContent).toBe(NBSP)
  })

  test.each([
    ['Ctrl+Space', { shiftKey: false }],
    ['Shift+Space', { ctrlKey: false }],
    ['Ctrl+Shift+Alt+Space', { altKey: true }],
    ['Ctrl+Shift+Meta+Space', { metaKey: true }]
  ])('%s does not insert one', (_label, init) => {
    const { editor, editable } = makeEditor()
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    pressCtrlShiftSpace(editable, init)

    expect(text(editor)).not.toContain(NBSP)
  })

  test('is not registered on macOS, where Option+Space types one natively', () => {
    asMac()
    const { editor, editable } = makeEditor()
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    const { prevented } = pressCtrlShiftSpace(editable)

    expect(text(editor)).toBe('ab')
    expect(prevented).toBe(false)
    expect(NonBreakingSpace().actions?.[0].hotkey).toBeUndefined()
  })

  test('a host plugin named core/nbsp replaces it', () => {
    // Passing plugins drops the standard set, so core/text is added back
    const { editor, editable } = makeEditor(undefined, [
      ...StandardPlugins.map((p) => p()),
      { class: 'generic', name: 'core/nbsp' }
    ])
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    const { prevented } = pressCtrlShiftSpace(editable)

    expect(text(editor)).toBe('ab')
    expect(prevented).toBe(false)
  })

  test('the action still inserts when invoked without a key event', () => {
    const { editor } = makeEditor()
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    act(() => {
      NonBreakingSpace().actions?.[0].handler({ editor, type: 'core/nbsp' })
    })

    expect(text(editor)).toBe(`ab${NBSP}`)
  })
})

describe('Ctrl+Shift+Space - with the caret parked beside a block', () => {
  const actions = registerActions([NonBreakingSpace()])

  function keyEvent() {
    return { ...ctrlShiftSpace, preventDefault: vi.fn() } as unknown as React.KeyboardEvent<HTMLDivElement>
  }

  // adjacentBlockContent: [text "Before", image block with body "Block content", text "After"]
  test.each([
    ['before', 1, 'Block content', { path: [1, 0, 0], offset: 0 }],
    ['after', 2, 'Block content', { path: [1, 0, 0], offset: 13 }]
  ] as const)('%s the block, the space goes in a new paragraph, not into the block', (
    direction, newIndex, blockText, parkedAt
  ) => {
    const { editor } = makeEditor(adjacentBlockContent)
    act(() => Transforms.select(editor, parkedAt))
    const setAdjacentBlock = vi.fn()
    const event = keyEvent()

    act(() => handleOnKeyDown(
      editor,
      actions,
      event,
      { blockId: 'non-text-block', direction },
      setAdjacentBlock,
      null,
      () => {}
    ))

    expect(editor.children).toHaveLength(4)
    expect(text(editor, newIndex)).toBe(NBSP)
    // The block the caret was parked by is untouched
    expect(text(editor, direction === 'before' ? 2 : 1)).toBe(blockText)
    expect(setAdjacentBlock).toHaveBeenCalledWith(null)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  test('a replaced action leaves the document alone instead of adding an empty paragraph', () => {
    const { editor } = makeEditor(adjacentBlockContent)
    act(() => Transforms.select(editor, { path: [1, 0, 0], offset: 0 }))

    act(() => handleOnKeyDown(
      editor,
      registerActions([{ class: 'generic', name: 'core/nbsp' }]),
      keyEvent(),
      { blockId: 'non-text-block', direction: 'before' },
      vi.fn(),
      null,
      () => {}
    ))

    expect(editor.children).toHaveLength(3)
    expect(Node.string(editor)).not.toContain(NBSP)
  })
})
