import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { StandardPlugins } from '../lib/components/core'
import { SpecialCharacters, type SpecialCharactersOptions } from '../lib/components/SpecialCharacters'
import { SpecialCharacterPicker } from '../lib/components/SpecialCharacters/Picker'
import { openSpecialCharacters } from '../lib/components/SpecialCharacters/open'
import { insertTextAtCaret } from '../lib/utils/insertTextAtCaret'
import { Item as MenuItem } from '../lib/components/ContentTools/Item'
import type { PluginDefinition } from '../lib/types'
import { adjacentBlockContent } from './_fixtures'

const NBSP = String.fromCharCode(0xa0)

// Rewrites a typed straight quote the way typographic-quote plugins do
const curlyQuotes: PluginDefinition = {
  class: 'generic',
  name: 'test/curly-quotes',
  consumer: {
    consumes: ({ input }) => [input.type === 'text/plain' && input.data === '"', 'text/plain'],
    consume: async ({ input }) => ({ ...(Array.isArray(input) ? input[0] : input), data: '”' })
  }
}

function setup({
  content = [{ id: 'a', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'ab' }] }],
  options,
  readOnly = false,
  withPlugin = true,
  onInsert,
  recent,
  children
}: {
  content?: Descendant[]
  options?: SpecialCharactersOptions
  readOnly?: boolean
  withPlugin?: boolean
  onInsert?: (char: string) => void
  recent?: string[]
  children?: React.ReactNode
} = {}) {
  let editor: Editor | undefined
  function Capture() {
    editor = useSlateStatic()
    return null
  }
  const plugins = [
    ...StandardPlugins.map((p) => p()),
    curlyQuotes,
    ...(withPlugin ? [SpecialCharacters(options)] : [])
  ]
  const { container } = render(
    <TextbitRoot value={content} onChange={() => {}} plugins={plugins} readOnly={readOnly}>
      <TextbitEditable>
        <Capture />
        <SpecialCharacterPicker
          placeholder='Search'
          recent={recent}
          recentLabel='Recent'
          emptyLabel='Nothing'
          onInsert={onInsert}
        />
        {children}
      </TextbitEditable>
    </TextbitRoot>
  )
  const editable = container.querySelector('[data-slate-editor]') as HTMLElement
  return { editor: editor!, editable }
}

const pane = () => document.querySelector('[data-tb-special-characters]')
const input = () => screen.getByRole('combobox') as HTMLInputElement
const text = (editor: Editor, index = 0) => Node.string(editor.children[index])

async function openAt(editor: Editor, at = Editor.end(editor, [0])) {
  act(() => Transforms.select(editor, at))
  act(() => {
    openSpecialCharacters(editor)
  })
}

function search(query: string) {
  act(() => {
    fireEvent.change(input(), { target: { value: query } })
  })
}

function press(key: string) {
  act(() => {
    fireEvent.keyDown(input(), { key })
  })
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

describe('special characters picker', () => {
  test('renders nothing until it is opened', () => {
    setup()
    expect(pane()).toBeNull()
  })

  test('opens with the search field focused, and inserts the chosen character at the caret', async () => {
    const onInsert = vi.fn()
    const { editor } = setup({ onInsert })

    await openAt(editor, { path: [0, 0], offset: 1 })
    expect(pane()).not.toBeNull()
    expect(document.activeElement).toBe(input())

    search('euro')
    press('Enter')

    expect(text(editor)).toBe('a€b')
    expect(pane()).toBeNull()
    expect(onInsert).toHaveBeenCalledWith('€')
  })

  test('arrow keys move through the results', async () => {
    const { editor } = setup()
    await openAt(editor)

    search('euro')
    press('ArrowDown')
    press('Enter')

    expect(text(editor)).toBe('ab₠')
  })

  test('a click inserts the character', async () => {
    const { editor } = setup()
    await openAt(editor)
    search('half')

    act(() => {
      fireEvent.click(screen.getByRole('option', { name: 'Vulgar fraction one half' }))
    })

    expect(text(editor)).toBe('ab½')
  })

  test('Escape closes without inserting', async () => {
    const { editor } = setup()
    await openAt(editor)
    search('euro')

    press('Escape')

    expect(pane()).toBeNull()
    expect(text(editor)).toBe('ab')
  })

  test('says so when nothing matches', async () => {
    const { editor } = setup()
    await openAt(editor)

    search('zzzz')

    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(pane()?.textContent).toContain('Nothing')
  })

  test('replaces a selection, as typing does', async () => {
    const { editor } = setup({
      content: [{ id: 'a', type: 'base/text', class: 'text', properties: {}, children: [{ text: '10 kr' }] }]
    })
    await openAt(editor, { anchor: { path: [0, 0], offset: 2 }, focus: { path: [0, 0], offset: 3 } })

    search('no-break space')
    press('Enter')

    expect(text(editor)).toBe(`10${NBSP}kr`)
  })

  test('inserts exactly what was picked, where typing the same key gets rewritten', async () => {
    const { editor } = setup({ options: { characters: ['0022'] } })

    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    await act(async () => {
      editor.insertText('"')
    })
    expect(text(editor)).toBe('ab”')

    await openAt(editor)
    search('"')
    press('Enter')

    expect(text(editor)).toBe('ab”"')
  })

  test('shows recently used first, and hides them while searching', async () => {
    const { editor } = setup({ recent: ['½', '€'] })
    await openAt(editor)

    const recent = () => [...document.querySelectorAll('[data-section="recent"] [role="option"]')]
      .map((o) => o.textContent)
    expect(recent()).toEqual(['½', '€'])

    search('arrow')
    expect(recent()).toEqual([])
  })

  test('invisible characters show their code point instead of a blank', async () => {
    const { editor } = setup({ options: { characters: ['00A0'] } })
    await openAt(editor)

    const option = screen.getByRole('option', { name: 'No-break space' })
    expect(option.textContent).toBe('00A0')
    expect(option.hasAttribute('data-invisible')).toBe(true)
  })

  test('uses translated names', async () => {
    const { editor } = setup({ options: { names: { '20AC': 'eurotecken' } } })
    await openAt(editor)

    search('eurotecken')

    expect(screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'))).toEqual(['eurotecken'])
  })

  test('does not open in a read-only editor', async () => {
    const { editor } = setup({ readOnly: true })
    await openAt(editor)
    expect(pane()).toBeNull()
  })

  test('does not open without the plugin', async () => {
    const { editor } = setup({ withPlugin: false })
    await openAt(editor)
    expect(pane()).toBeNull()
  })

  test('a shortcut the host configures opens it', () => {
    const { editor, editable } = setup({ options: { hotkey: 'ctrl+alt+c' } })
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    let notPrevented = true
    act(() => {
      notPrevented = fireEvent.keyDown(editable, {
        key: 'c', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true, altKey: true
      })
    })

    expect(pane()).not.toBeNull()
    expect(notPrevented).toBe(false)
  })

  test('opened from a caret parked beside a block, inserts in a new paragraph there', () => {
    const { editor, editable } = setup({ content: adjacentBlockContent, options: { hotkey: 'ctrl+alt+c' } })
    // Park the caret: ArrowRight at the end of the text before the block
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    act(() => {
      fireEvent.keyDown(editable, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 })
    })
    // The shortcut leaves the parked caret during the same keydown that opens the pane
    act(() => {
      fireEvent.keyDown(editable, { key: 'c', code: 'KeyC', keyCode: 67, which: 67, ctrlKey: true, altKey: true })
    })

    search('euro')
    press('Enter')

    expect(editor.children).toHaveLength(4)
    expect(text(editor, 1)).toBe('€')
    expect(text(editor, 2)).toBe('Block content')
  })

  test('a menu item can open it', async () => {
    const { editor } = setup({
      children: <MenuItem action='core/specialchars/open'>Special characters</MenuItem>
    })
    act(() => Transforms.select(editor, Editor.end(editor, [0])))
    // Slate tells components about the new selection in a microtask
    await act(async () => {})

    // Menu items hide actions that do not say they are visible
    const item = screen.getByText('Special characters')
    act(() => {
      fireEvent.mouseDown(item)
    })

    expect(pane()).not.toBeNull()
  })

  test('the insert action inserts a character the host chooses', () => {
    const { editor } = setup()
    act(() => Transforms.select(editor, Editor.end(editor, [0])))

    act(() => {
      SpecialCharacters().actions?.find((a) => a.name === 'insert')?.handler({
        editor, type: 'core/specialchars', args: { char: '–' }
      })
    })

    expect(text(editor)).toBe('ab–')
  })
})

describe('insertTextAtCaret', () => {
  // adjacentBlockContent: [text "Before", image block with body "Block content", text "After"]
  test.each([
    ['before', 1, { path: [1, 0, 0], offset: 0 }],
    ['after', 2, { path: [1, 0, 0], offset: 13 }]
  ] as const)('with the caret parked %s a block, inserts in a new paragraph beside it', (
    direction, newIndex, parkedAt
  ) => {
    const { editor } = setup({ content: adjacentBlockContent })
    act(() => Transforms.select(editor, parkedAt))

    act(() => {
      insertTextAtCaret(editor, '€', { blockId: 'non-text-block', direction })
    })

    expect(editor.children).toHaveLength(4)
    expect(text(editor, newIndex)).toBe('€')
    expect(text(editor, direction === 'before' ? 2 : 1)).toBe('Block content')
  })

  test('removes a selection through the guarded deleteFragment, not around it', () => {
    // The block boundary guard wraps deleteFragment, so going through it keeps
    // a selection across a block from merging the block away
    const { editor } = setup()
    const deleteFragment = vi.spyOn(editor, 'deleteFragment')
    act(() => Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 1 } }))

    act(() => {
      insertTextAtCaret(editor, '€')
    })

    expect(deleteFragment).toHaveBeenCalled()
    expect(text(editor)).toBe('€b')
  })

  test('without a selection there is nowhere to insert', () => {
    const { editor } = setup()
    act(() => Transforms.deselect(editor))

    expect(insertTextAtCaret(editor, '€')).toBe(false)
    expect(text(editor)).toBe('ab')
  })
})
