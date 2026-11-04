import { describe, test, expect, vi } from 'vitest'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { Editor, Transforms, type Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { useContextMenuHints } from '../lib/components/ContextMenu/useContextMenuHints'
import type { ContextMenuMode } from '../lib/hooks/useContextMenu'
import type { SpellingError } from '../lib/types'

const content: Descendant[] = [
  { id: 'a', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'This is teh text' }] }
]

// Marks "teh" as misspelled
const onSpellcheck = vi.fn((texts: { lang: string, text: string }[]) => Promise.resolve(
  texts.map(({ text }) => text.includes('teh')
    ? [{ text: 'teh', level: 'error' as const, suggestions: [{ text: 'the' }] }] satisfies Omit<SpellingError, 'id'>[]
    : [])
))

function setup(mode?: ContextMenuMode) {
  let editor: Editor | undefined
  let hints: ReturnType<typeof useContextMenuHints> | undefined
  function Probe() {
    editor = useSlateStatic()
    hints = useContextMenuHints()
    return null
  }
  const { container } = render(
    <TextbitRoot value={content} onChange={() => {}} onSpellcheck={onSpellcheck} spellcheckDebounce={10}>
      <TextbitEditable contextMenu={mode}>
        <Probe />
      </TextbitEditable>
    </TextbitRoot>
  )
  return { editor: editor!, hints: () => hints!, container }
}

function rightClick(target: Element) {
  let notPrevented = true
  act(() => {
    notPrevented = fireEvent.contextMenu(target, { clientX: 10, clientY: 10 })
  })
  return { prevented: !notPrevented }
}

const plainLeaf = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slate-string]')].find((s) => s.textContent === 'This is ') as HTMLElement

const misspelledLeaf = async (container: HTMLElement) => {
  await waitFor(() => expect(container.querySelector('[data-spelling-error]')).not.toBeNull(), { timeout: 1000 })
  return container.querySelector('[data-spelling-error] [data-slate-string]') as HTMLElement
}

describe('context menu - default mode', () => {
  test('opens on a misspelled word with its spelling hints', async () => {
    const { hints, container } = setup()

    rightClick(await misspelledLeaf(container))

    expect(hints().menu).toBeDefined()
    expect(hints().spelling?.text).toBe('teh')
  })

  test('stays closed on other text, as before', async () => {
    const { hints, container } = setup()
    await misspelledLeaf(container)

    const { prevented } = rightClick(plainLeaf(container))

    expect(hints().menu).toBeUndefined()
    expect(prevented).toBe(true)
  })
})

describe('context menu - always mode', () => {
  test('opens on any text, without spelling hints', async () => {
    const { hints, container } = setup('always')
    await misspelledLeaf(container)

    rightClick(plainLeaf(container))

    expect(hints().menu).toBeDefined()
    expect(hints().spelling).toBeUndefined()
  })

  test('still gives spelling hints on a misspelled word', async () => {
    const { hints, container } = setup('always')

    rightClick(await misspelledLeaf(container))

    expect(hints().spelling?.text).toBe('teh')
  })
})

describe('context menu - selection', () => {
  // jsdom has no layout, so map every click to offset 3 of the plain leaf
  function clickLandsAt(leaf: HTMLElement, offset: number) {
    const range = document.createRange()
    range.setStart(leaf.firstChild!, offset)
    range.collapse(true)
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range }
    doc.caretRangeFromPoint = () => range
    return () => {
      delete doc.caretRangeFromPoint
    }
  }

  test.each([undefined, 'always'] as const)(
    'a right-click on plain text puts the caret at the click, not around the whole text (%s mode)',
    async (mode) => {
      const { editor, container } = setup(mode)
      await misspelledLeaf(container)
      act(() => Transforms.select(editor, { path: [0, 0], offset: 0 }))
      const restore = clickLandsAt(plainLeaf(container), 3)

      rightClick(plainLeaf(container))
      restore()

      // Before, the whole leaf ended up selected and the next keystroke replaced it
      const at = { path: [0, 0], offset: 3 }
      expect(editor.selection).toEqual({ anchor: at, focus: at })
    }
  )

  test('a right-click inside a selection keeps it, so a menu action can use it', async () => {
    const { editor, container } = setup('always')
    await misspelledLeaf(container)
    const selection = { anchor: { path: [0, 0], offset: 1 }, focus: { path: [0, 0], offset: 6 } }
    act(() => Transforms.select(editor, selection))
    const restore = clickLandsAt(plainLeaf(container), 3)

    rightClick(plainLeaf(container))
    restore()

    expect(editor.selection).toEqual(selection)
  })
})
