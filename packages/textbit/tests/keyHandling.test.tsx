import { describe, test, expect, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, Node, Transforms } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { handleOnKeyDown } from '../lib/components/TextbitEditable/handleOnKeyDown/handleOnKeyDown'
import { registerActions } from '../lib/contexts/PluginRegistry/lib/registerAction'
import type { PluginDefinition } from '../lib/types'
import { adjacentBlockContent } from './_fixtures'

function makeEditor(content = adjacentBlockContent) {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  render(
    <TextbitRoot value={content} onChange={() => {}}>
      <TextbitEditable><Capture /></TextbitEditable>
    </TextbitRoot>
  )
  return editor!
}

function keyEvent(init: {
  key: string
  which?: number
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
  altGraph?: boolean
}) {
  const native = new KeyboardEvent('keydown', {
    key: init.key,
    ctrlKey: init.ctrlKey,
    altKey: init.altKey,
    shiftKey: init.shiftKey,
    metaKey: init.metaKey,
    modifierAltGraph: init.altGraph
  } as KeyboardEventInit)
  Object.defineProperty(native, 'which', { value: init.which ?? init.key.toUpperCase().charCodeAt(0) })
  return {
    ...init,
    which: init.which ?? init.key.toUpperCase().charCodeAt(0),
    nativeEvent: native,
    getModifierState: (k: string) => native.getModifierState(k),
    preventDefault: vi.fn()
  } as unknown as React.KeyboardEvent<HTMLDivElement>
}

function plugin(name: string, hotkey: string, handler: () => void, when?: (editor: Editor) => boolean): PluginDefinition {
  return { class: 'generic', name, actions: [{ name: 'act', hotkey, handler, when }] }
}

const press = (editor: Editor, plugins: PluginDefinition[], event: React.KeyboardEvent<HTMLDivElement>) =>
  act(() => handleOnKeyDown(editor, registerActions(plugins), event, null, () => {}, null, () => {}))

describe('several actions on one key', () => {
  test('an action whose when() is false passes the key on to the next', () => {
    const editor = makeEditor()
    const first = vi.fn()
    const second = vi.fn()

    press(editor, [
      plugin('test/first', 'tab', first, () => false),
      plugin('test/second', 'tab', second, () => true)
    ], keyEvent({ key: 'Tab', which: 9 }))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  test('the first action whose when() is true takes the key, as before', () => {
    const editor = makeEditor()
    const first = vi.fn()
    const second = vi.fn()

    press(editor, [
      plugin('test/first', 'tab', first, () => true),
      plugin('test/second', 'tab', second)
    ], keyEvent({ key: 'Tab', which: 9 }))

    expect(first).toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })

  test('when() sees the editor, so it can check where the caret is', () => {
    const editor = makeEditor()
    act(() => Transforms.select(editor, { path: [1, 0, 0], offset: 0 }))
    const inBlock = vi.fn()

    press(editor, [
      plugin('test/block-tab', 'tab', inBlock, (e) => e.selection?.anchor.path[0] === 1)
    ], keyEvent({ key: 'Tab', which: 9 }))

    expect(inBlock).toHaveBeenCalled()
  })
})

describe('AltGr', () => {
  test('a character typed with AltGr never triggers a Ctrl+Alt shortcut', () => {
    // Windows reports AltGr+2 on a Swedish keyboard as Ctrl+Alt with key "@"
    const editor = makeEditor()
    const heading = vi.fn()

    press(editor, [plugin('test/heading', 'ctrl+alt+2', heading)],
      keyEvent({ key: '@', which: 50, ctrlKey: true, altKey: true, altGraph: true }))

    expect(heading).not.toHaveBeenCalled()
  })

  test('a real Ctrl+Alt shortcut still works', () => {
    const editor = makeEditor()
    const heading = vi.fn()

    press(editor, [plugin('test/heading', 'ctrl+alt+2', heading)],
      keyEvent({ key: '2', which: 50, ctrlKey: true, altKey: true }))

    expect(heading).toHaveBeenCalled()
  })

  test('AltGr with a key that types nothing can still be a shortcut', () => {
    const editor = makeEditor()
    const move = vi.fn()

    press(editor, [plugin('test/move', 'ctrl+alt+up', move)],
      keyEvent({ key: 'ArrowUp', which: 38, ctrlKey: true, altKey: true, altGraph: true }))

    expect(move).toHaveBeenCalled()
  })
})

describe('typing with the caret parked beside a block', () => {
  // adjacentBlockContent: [text "Before", image block "Block content", text "After"]
  test.each([
    ['Option on a Mac', { key: '™', altKey: true }],
    ['AltGr on Windows', { key: '@', ctrlKey: true, altKey: true, altGraph: true }]
  ] as const)('a character typed with %s starts a new paragraph, like any other', (_label, init) => {
    const editor = makeEditor()
    act(() => Transforms.select(editor, { path: [1, 0, 0], offset: 0 }))
    const setAdjacentBlock = vi.fn()

    act(() => handleOnKeyDown(editor, [], keyEvent(init), { blockId: 'non-text-block', direction: 'before' },
      setAdjacentBlock, null, () => {}))

    expect(editor.children).toHaveLength(4)
    expect(Node.string(editor.children[1])).toBe('')
    expect(editor.selection?.anchor.path).toEqual([1, 0])
    expect(setAdjacentBlock).toHaveBeenCalledWith(null)
  })

  test('a Ctrl shortcut does not', () => {
    const editor = makeEditor()
    act(() => Transforms.select(editor, { path: [1, 0, 0], offset: 0 }))

    act(() => handleOnKeyDown(editor, [], keyEvent({ key: 'b', ctrlKey: true }),
      { blockId: 'non-text-block', direction: 'before' }, () => {}, null, () => {}))

    expect(editor.children).toHaveLength(3)
  })
})
