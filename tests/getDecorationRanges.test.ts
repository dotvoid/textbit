import { describe, test, expect } from 'vitest'
import { createEditor, Node, type Descendant, type Editor } from 'slate'
import { getDecorationRanges } from '../lib/utils/getDecorationRanges'
import type { SpellcheckLookupTable } from '../lib/types'
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
