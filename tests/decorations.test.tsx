import { describe, test, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { createEditor, Node, Text, type Descendant, type Editor, type Path } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { getDecorationRanges } from '../lib/utils/getDecorationRanges'
import { getLeafMarkIds } from '../lib/utils/decorationMarks'
import type { Decoration, SpellcheckLookupTable, SpellingError } from '../lib/types'
import type { PluginRegistryComponent } from '../lib/contexts/PluginRegistry/lib/types'

const emptySpellcheck: SpellcheckLookupTable = new Map()
const emptyComponents: Map<string, PluginRegistryComponent> = new Map()

function block(id: string, text: string): Descendant {
  return { type: 'core/text', class: 'text', id, properties: {}, children: [{ text }] }
}

function makeEditor(value: Descendant[]): Editor {
  const editor = createEditor()
  editor.children = value
  return editor
}

function decoration(id: string, from: [Path, number], to: [Path, number]): Decoration {
  return {
    id,
    range: {
      anchor: { path: from[0], offset: from[1] },
      focus: { path: to[0], offset: to[1] }
    }
  }
}

/**
 * The leaves Slate renders for one text node: decorate it, then split it the way
 * slate-react does, and report each piece's text with its mark ids.
 */
function leavesAt(
  editor: Editor,
  path: Path,
  decorations: Decoration[],
  spelling: SpellcheckLookupTable = emptySpellcheck
) {
  const node = Node.get(editor, path)
  if (!Text.isText(node)) {
    throw new Error(`No text node at ${path.join(',')}`)
  }

  const ranges = getDecorationRanges(
    editor,
    spelling,
    [node, path],
    emptyComponents,
    'none',
    undefined,
    undefined,
    undefined,
    decorations
  )

  return Text.decorations(node, ranges).map(({ leaf }) => ({
    text: leaf.text,
    marks: getLeafMarkIds(leaf),
    spellingError: leaf.spellingError
  }))
}

describe('getDecorationRanges - caller decorations', () => {
  test('a decoration over part of one text node splits it around the mark', () => {
    const editor = makeEditor([block('a', 'The quick brown fox')])
    const leaves = leavesAt(editor, [0, 0], [decoration('m1', [[0, 0], 4], [[0, 0], 9])])

    expect(leaves).toEqual([
      { text: 'The ', marks: [], spellingError: undefined },
      { text: 'quick', marks: ['m1'], spellingError: undefined },
      { text: ' brown fox', marks: [], spellingError: undefined }
    ])
  })

  test('a backwards range marks the same text as a forward one', () => {
    const editor = makeEditor([block('a', 'The quick brown fox')])
    const leaves = leavesAt(editor, [0, 0], [decoration('m1', [[0, 0], 9], [[0, 0], 4])])

    expect(leaves.filter((l) => l.marks.length).map((l) => l.text)).toEqual(['quick'])
  })

  test('a decoration spanning two blocks marks a piece in each', () => {
    const editor = makeEditor([block('a', 'First block'), block('b', 'Second block')])
    const span = [decoration('m1', [[0, 0], 6], [[1, 0], 6])]

    expect(leavesAt(editor, [0, 0], span).map((l) => [l.text, l.marks])).toEqual([
      ['First ', []],
      ['block', ['m1']]
    ])
    expect(leavesAt(editor, [1, 0], span).map((l) => [l.text, l.marks])).toEqual([
      ['Second', ['m1']],
      [' block', []]
    ])
  })

  test('a block entirely inside a decoration is marked whole', () => {
    const editor = makeEditor([block('a', 'One'), block('b', 'Two'), block('c', 'Three')])
    const span = [decoration('m1', [[0, 0], 1], [[2, 0], 2])]

    expect(leavesAt(editor, [1, 0], span).map((l) => [l.text, l.marks])).toEqual([
      ['Two', ['m1']]
    ])
  })

  test('decorations that only touch a node at its edge do not mark it', () => {
    const editor = makeEditor([block('a', 'First'), block('b', 'Second')])
    const span = [decoration('m1', [[0, 0], 2], [[1, 0], 0])]

    expect(leavesAt(editor, [1, 0], span).map((l) => l.marks)).toEqual([[]])
  })

  test('overlapping decorations both appear on the overlapping leaf, sorted', () => {
    const editor = makeEditor([block('a', 'abcdefghij')])
    const leaves = leavesAt(editor, [0, 0], [
      decoration('zeta', [[0, 0], 2], [[0, 0], 6]),
      decoration('alpha', [[0, 0], 4], [[0, 0], 8])
    ])

    expect(leaves.map((l) => [l.text, l.marks])).toEqual([
      ['ab', []],
      ['cd', ['zeta']],
      ['ef', ['alpha', 'zeta']],
      ['gh', ['alpha']],
      ['ij', []]
    ])
  })

  test('spelling decorations are unchanged alongside caller decorations', () => {
    const editor = makeEditor([block('a', 'This is teh world')])
    const spellingError: SpellingError = {
      id: 'e1',
      text: 'teh',
      level: 'error',
      suggestions: [{ text: 'the' }]
    }
    const spelling: SpellcheckLookupTable = new Map([
      ['a', { lang: 'en', text: 'This is teh world', errors: [spellingError] }]
    ])
    const node = Node.get(editor, [0, 0])
    const spellingOnly = (decorations?: Decoration[]) => getDecorationRanges(
      editor,
      spelling,
      [node, [0, 0]],
      emptyComponents,
      'none',
      undefined,
      undefined,
      undefined,
      decorations
    ).filter((r) => 'spellingError' in r)

    const covering = [decoration('m1', [[0, 0], 5], [[0, 0], 17])]
    expect(spellingOnly(covering)).toEqual(spellingOnly())
    expect(spellingOnly()).toHaveLength(1)

    const teh = leavesAt(editor, [0, 0], covering, spelling).find((l) => l.text === 'teh')
    expect(teh).toEqual({ text: 'teh', marks: ['m1'], spellingError })
  })
})

describe('Textbit.Editable decorations', () => {
  function editable(value: Descendant[], decorations?: Decoration[]) {
    return (
      <TextbitRoot value={value} onChange={() => {}}>
        <TextbitEditable decorations={decorations} />
      </TextbitRoot>
    )
  }

  function marked(container: HTMLElement) {
    return [...container.querySelectorAll<HTMLElement>('[data-tb-mark]')].map((el) => ({
      text: el.textContent,
      mark: el.getAttribute('data-tb-mark'),
      isMarkClass: el.classList.contains('tb-mark')
    }))
  }

  test('renders marked leaves with data-tb-mark and the tb-mark class', () => {
    const value = [block('a', 'abcdefghij'), block('b', 'klmnop')]
    const { container } = render(editable(value, [
      decoration('zeta', [[0, 0], 2], [[0, 0], 6]),
      decoration('alpha', [[0, 0], 4], [[1, 0], 3])
    ]))

    expect(marked(container)).toEqual([
      { text: 'cd', mark: 'zeta', isMarkClass: true },
      { text: 'ef', mark: 'alpha zeta', isMarkClass: true },
      { text: 'ghij', mark: 'alpha', isMarkClass: true },
      { text: 'klm', mark: 'alpha', isMarkClass: true }
    ])
    expect(container.querySelectorAll('[data-tb-mark~="alpha"]')).toHaveLength(3)
    expect(container.querySelectorAll('.tb-mark')).toHaveLength(4)
  })

  test('keeps leaf plugin styles on a marked leaf', () => {
    const value: Descendant[] = [{
      type: 'core/text',
      class: 'text',
      id: 'a',
      properties: {},
      children: [{ text: 'plain ' }, { text: 'bold', 'core/bold': true }]
    }]
    const { container } = render(editable(value, [
      decoration('m1', [[0, 0], 3], [[0, 1], 2])
    ]))

    const pieces = [...container.querySelectorAll<HTMLElement>('[data-tb-mark="m1"]')]
    expect(pieces.map((el) => el.textContent)).toEqual(['in ', 'bo'])
    expect(pieces[1].style.fontWeight).toBe('bold')
    expect(pieces[1].classList.contains('leaf')).toBe(true)
  })

  test('re-decorates when the decorations prop changes', async () => {
    const value = [block('a', 'The quick brown fox')]
    const { container, rerender } = render(editable(value, [
      decoration('m1', [[0, 0], 4], [[0, 0], 9])
    ]))
    expect(marked(container).map((m) => m.text)).toEqual(['quick'])

    rerender(editable(value, [decoration('m2', [[0, 0], 10], [[0, 0], 15])]))
    await waitFor(() => {
      expect(marked(container)).toEqual([{ text: 'brown', mark: 'm2', isMarkClass: true }])
    })

    rerender(editable(value, []))
    await waitFor(() => {
      expect(marked(container)).toEqual([])
    })
  })

  test('a misspelled word inside a decoration keeps its spelling attributes', async () => {
    const onSpellcheck = vi.fn((texts: { lang: string, text: string }[]) => Promise.resolve(
      texts.map((t) => t.text.includes('teh')
        ? [{ text: 'teh', level: 'error' as const, suggestions: [{ text: 'the' }] }]
        : [])
    ))
    const value = [block('a', 'This is teh world')]
    const decorations = [decoration('m1', [[0, 0], 5], [[0, 0], 17])]

    const { container } = render(
      <TextbitRoot
        value={value}
        onChange={() => {}}
        onSpellcheck={onSpellcheck}
        spellcheckDebounce={10}
      >
        <TextbitEditable decorations={decorations} />
      </TextbitRoot>
    )

    await waitFor(() => {
      expect(container.querySelector('[data-spelling-error]')).not.toBeNull()
    }, { timeout: 500 })

    const teh = container.querySelector('[data-spelling-error]')
    expect(teh?.textContent).toBe('teh')
    expect(teh?.getAttribute('data-spelling-level')).toBe('error')
    expect(teh?.getAttribute('data-tb-mark')).toBe('m1')
    expect(teh?.classList.contains('tb-mark')).toBe(true)
  })
})
