import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, Transforms } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { StandardPlugins } from '../lib/components/core'
import { FocusToolbar, focusToolbar, registerToolbarFocus } from '../lib/components/core/FocusToolbar'
import type { PluginDefinition } from '../lib/types'

// What a browser reports for Alt+F10; is-hotkey matches on `which`
const altF10 = { key: 'F10', code: 'F10', keyCode: 121, which: 121, altKey: true }

function setup(plugins?: PluginDefinition[]) {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const { container } = render(
    <TextbitRoot value='Hello world' onChange={() => {}} plugins={plugins}>
      <TextbitEditable><Capture /></TextbitEditable>
    </TextbitRoot>
  )
  const editable = container.querySelector('[data-slate-editor]') as HTMLElement
  act(() => Transforms.select(editor!, Editor.end(editor!, [])))
  return { editor: editor!, editable }
}

function press(editable: HTMLElement) {
  let notPrevented = true
  act(() => {
    notPrevented = fireEvent.keyDown(editable, altF10)
  })
  return { prevented: !notPrevented }
}

// slate-react only handles keys whose target is editable, which it checks with
// isContentEditable. jsdom does not implement it.
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

describe('FocusToolbar', () => {
  test('uses Alt+F10 by default, the toolbar key of other web editors', () => {
    expect(FocusToolbar().actions?.[0].hotkey).toBe('alt+f10')
  })

  test('the key can be changed, or removed', () => {
    expect(FocusToolbar({ hotkey: 'alt+f9' }).actions?.[0].hotkey).toBe('alt+f9')
    expect(FocusToolbar({ hotkey: false }).actions?.[0].hotkey).toBeUndefined()
  })

  test('Alt+F10 in the editor moves focus to the toolbar', () => {
    const { editor, editable } = setup()
    const toolbar = vi.fn(() => true)
    const unregister = registerToolbarFocus(editor, 'toolbar', toolbar)

    const { prevented } = press(editable)

    expect(toolbar).toHaveBeenCalled()
    expect(prevented).toBe(true)
    unregister()
  })

  test('with the toolbar hidden, the gutter menu button gets focus instead', () => {
    const { editor } = setup()
    const gutter = vi.fn(() => true)
    const unregisterToolbar = registerToolbarFocus(editor, 'toolbar', () => false)
    const unregisterGutter = registerToolbarFocus(editor, 'gutter', gutter)

    expect(focusToolbar(editor)).toBe(true)
    expect(gutter).toHaveBeenCalled()
    unregisterToolbar()
    unregisterGutter()
  })

  test('when nothing can take focus, the key is left to the browser', () => {
    const { editable } = setup()
    const { prevented } = press(editable)
    expect(prevented).toBe(false)
  })

  test('a host can remove the key by registering the plugin again', () => {
    const { editor, editable } = setup([...StandardPlugins.map((p) => p()), FocusToolbar({ hotkey: false })])
    const toolbar = vi.fn(() => true)
    const unregister = registerToolbarFocus(editor, 'toolbar', toolbar)

    press(editable)

    expect(toolbar).not.toHaveBeenCalled()
    unregister()
  })

  test('each editor reaches its own toolbar', () => {
    const one = setup()
    const two = setup()
    const toolbarOne = vi.fn(() => true)
    const toolbarTwo = vi.fn(() => true)
    const unregisterOne = registerToolbarFocus(one.editor, 'toolbar', toolbarOne)
    const unregisterTwo = registerToolbarFocus(two.editor, 'toolbar', toolbarTwo)

    press(two.editable)

    expect(toolbarTwo).toHaveBeenCalled()
    expect(toolbarOne).not.toHaveBeenCalled()
    unregisterOne()
    unregisterTwo()
  })
})
