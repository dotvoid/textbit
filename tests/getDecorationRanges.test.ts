import { describe, test, expect } from 'vitest'
import { createEditor, Node, type Descendant, type Editor } from 'slate'
import { getDecorationRanges } from '../lib/utils/getDecorationRanges'
import type { SpellcheckLookupTable, SpellingError } from '../lib/types'
import type { PluginRegistryComponent } from '../lib/contexts/PluginRegistry/lib/types'

function makeEditor(value: Descendant[]): Editor {
  const editor = createEditor()
  editor.children = value
  return editor
}

const emptySpellcheck: SpellcheckLookupTable = new Map()
const emptyComponents: Map<string, PluginRegistryComponent> = new Map()

function placeholderRangesForFirstChild(editor: Editor, placeholder: string) {
  // Path [0, 0]: the first text leaf of the first block — the only path that
  // can carry a 'single'-mode placeholder. The editor-empty boolean mirrors
  // what TextbitEditable derives via useSlateSelector.
  const node = Node.get(editor, [0, 0])
  const editorIsEmpty = editor.children.every((c) => Node.string(c) === '')
  return getDecorationRanges(
    editor,
    emptySpellcheck,
    [node, [0, 0]],
    emptyComponents,
    'single',
    placeholder,
    editorIsEmpty
  ).filter(r => 'placeholder' in r)
}

const NBSP = String.fromCharCode(0xa0)

function nbspRangesFor(editor: Editor, path: number[]) {
  const node = Node.get(editor, path)
  return getDecorationRanges(
    editor,
    emptySpellcheck,
    [node, path],
    emptyComponents
  ).filter((r) => 'nbsp' in r)
}

describe('getDecorationRanges — non-breaking spaces', () => {
  test('emits one range per NBSP in a text leaf', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'a',
        properties: {},
        children: [{ text: `1${NBSP}000 kr` }]
      }
    ])

    const ranges = nbspRangesFor(editor, [0, 0])
    expect(ranges).toHaveLength(1)
    expect(ranges[0].anchor).toEqual({ path: [0, 0], offset: 1 })
    expect(ranges[0].focus).toEqual({ path: [0, 0], offset: 2 })
    expect(ranges[0].nbsp).toBe(true)
  })

  test('emits multiple ranges when several NBSPs are present', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'a',
        properties: {},
        children: [{ text: `1${NBSP}000${NBSP}kr` }]
      }
    ])

    const ranges = nbspRangesFor(editor, [0, 0])
    expect(ranges).toHaveLength(2)
    expect(ranges.map((r) => r.anchor.offset)).toEqual([1, 5])
  })

  test('emits no NBSP ranges when the text contains only regular spaces', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'a',
        properties: {},
        children: [{ text: 'hello world' }]
      }
    ])

    const ranges = nbspRangesFor(editor, [0, 0])
    expect(ranges).toHaveLength(0)
  })
})

describe('getDecorationRanges — newlines (soft breaks)', () => {
  test('emits one range per `\\n` in a text leaf', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'a',
        properties: {},
        children: [{ text: 'first\nsecond' }]
      }
    ])

    const node = Node.get(editor, [0, 0])
    const ranges = getDecorationRanges(
      editor,
      emptySpellcheck,
      [node, [0, 0]],
      emptyComponents
    ).filter((r) => 'newline' in r)

    expect(ranges).toHaveLength(1)
    expect(ranges[0].anchor).toEqual({ path: [0, 0], offset: 5 })
    expect(ranges[0].focus).toEqual({ path: [0, 0], offset: 6 })
    expect(ranges[0].newline).toBe(true)
  })

  test('emits multiple ranges for multiple `\\n`s', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'a',
        properties: {},
        children: [{ text: 'a\nb\nc' }]
      }
    ])

    const node = Node.get(editor, [0, 0])
    const ranges = getDecorationRanges(
      editor,
      emptySpellcheck,
      [node, [0, 0]],
      emptyComponents
    ).filter((r) => 'newline' in r)

    expect(ranges).toHaveLength(2)
    expect(ranges.map((r) => r.anchor.offset)).toEqual([1, 3])
  })

  test('emits both NBSP and newline ranges when mixed', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'a',
        properties: {},
        children: [{ text: `1${NBSP}000\nkr` }]
      }
    ])

    const node = Node.get(editor, [0, 0])
    const all = getDecorationRanges(
      editor,
      emptySpellcheck,
      [node, [0, 0]],
      emptyComponents
    )
    const nbsp = all.filter((r) => 'nbsp' in r)
    const nl = all.filter((r) => 'newline' in r)

    expect(nbsp).toHaveLength(1)
    expect(nbsp[0].anchor.offset).toBe(1)
    expect(nl).toHaveLength(1)
    expect(nl[0].anchor.offset).toBe(5)
  })

  test('emits no newline ranges when the text has no `\\n`', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'a',
        properties: {},
        children: [{ text: 'plain text' }]
      }
    ])

    const node = Node.get(editor, [0, 0])
    const ranges = getDecorationRanges(
      editor,
      emptySpellcheck,
      [node, [0, 0]],
      emptyComponents
    ).filter((r) => 'newline' in r)

    expect(ranges).toHaveLength(0)
  })
})

describe("getDecorationRanges — 'single' placeholder", () => {
  test('emits placeholder when the editor is entirely empty', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'only-block',
        properties: {},
        children: [{ text: '' }]
      }
    ])

    const ranges = placeholderRangesForFirstChild(editor, 'Type here…')
    expect(ranges).toHaveLength(1)
    expect(ranges[0].placeholder).toBe('Type here…')
  })

  test('omits placeholder when a later block has content', () => {
    // Reproduces the "newlines at start" bug: the first block is empty
    // because the user pressed Enter at the very start, but a following
    // block already contains text — the editor as a whole is not empty.
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'empty-first',
        properties: {},
        children: [{ text: '' }]
      },
      {
        type: 'core/text',
        class: 'text',
        id: 'has-content',
        properties: {},
        children: [{ text: 'Hello world' }]
      }
    ])

    const ranges = placeholderRangesForFirstChild(editor, 'Type here…')
    expect(ranges).toHaveLength(0)
  })

  test('omits placeholder when the first block has content', () => {
    const editor = makeEditor([
      {
        type: 'core/text',
        class: 'text',
        id: 'only-block',
        properties: {},
        children: [{ text: 'Hello' }]
      }
    ])

    const ranges = placeholderRangesForFirstChild(editor, 'Type here…')
    expect(ranges).toHaveLength(0)
  })
})

function spellingTable(errors: SpellingError[]): SpellcheckLookupTable {
  return new Map([['a', { lang: 'sv-SE', text: '', errors }]])
}

function spellingError(id: string, text: string): SpellingError {
  return { id, text, level: 'error', suggestions: [] }
}

function spellingRangesFor(
  text: string,
  errors: SpellingError[],
  isSpellingAccepted?: (error: SpellingError) => boolean
) {
  const editor = makeEditor([
    { type: 'core/text', class: 'text', id: 'a', properties: {}, children: [{ text }] }
  ])
  const node = Node.get(editor, [0, 0])
  return getDecorationRanges(
    editor,
    spellingTable(errors),
    [node, [0, 0]],
    emptyComponents,
    undefined,
    undefined,
    undefined,
    isSpellingAccepted
  ).filter((r) => 'spellingError' in r)
}

describe('getDecorationRanges — accepted spelling errors', () => {
  test('marks accepted errors instead of dropping their ranges', () => {
    const errors = [spellingError('e1', 'Lundqvist')]
    const ranges = spellingRangesFor('Danne Lundqvist', errors, () => true)

    expect(ranges).toHaveLength(1)
    expect(ranges[0].spellingAccepted).toBe(true)
    // The error itself is still on the range — the mark changes, it is not removed.
    expect(ranges[0].spellingError?.id).toBe('e1')
  })

  test('leaves unaccepted errors marked as errors', () => {
    const errors = [spellingError('e1', 'Lundqvist'), spellingError('e2', 'teh')]
    const ranges = spellingRangesFor(
      'Lundqvist teh',
      errors,
      (error) => error.text === 'Lundqvist'
    )

    const byId = Object.fromEntries(ranges.map((r) => [r.spellingError?.id, r.spellingAccepted]))
    expect(byId).toEqual({ e1: true, e2: false })
  })

  test('spellingAccepted is false when no predicate is supplied', () => {
    const ranges = spellingRangesFor('Lundqvist', [spellingError('e1', 'Lundqvist')])

    expect(ranges).toHaveLength(1)
    expect(ranges[0].spellingAccepted).toBe(false)
  })

  test('a truthy non-boolean answer does not count as accepted', () => {
    const ranges = spellingRangesFor(
      'Lundqvist',
      [spellingError('e1', 'Lundqvist')],
      (() => 'yes') as unknown as (error: SpellingError) => boolean
    )

    expect(ranges[0].spellingAccepted).toBe(false)
  })

  test('asks once per error and marks every occurrence of it', () => {
    const asked: string[] = []
    const ranges = spellingRangesFor(
      'Lundqvist and Lundqvist again',
      [spellingError('e1', 'Lundqvist')],
      (error) => {
        asked.push(error.text)
        return true
      }
    )

    // Two matches in the text, but the question was asked once.
    expect(ranges).toHaveLength(2)
    expect(asked).toEqual(['Lundqvist'])
    expect(ranges.every((r) => r.spellingAccepted === true)).toBe(true)
  })

  test('receives the whole error, so hosts can decide on level or suggestions', () => {
    const received: SpellingError[] = []
    const error: SpellingError = {
      id: 'e1',
      text: 'Lundqvist',
      level: 'suggestion',
      suggestions: [{ text: 'Lindqvist' }]
    }

    spellingRangesFor('Lundqvist', [error], (e) => {
      received.push(e)
      return false
    })

    expect(received).toEqual([error])
  })
})
