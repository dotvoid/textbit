import { describe, test, expect } from 'vitest'
import { createEditor, type Descendant, type Editor, type Element } from 'slate'
import { withInsertSoftBreak } from '../lib/with/withInsertSoftBreak'
import type { PluginRegistryComponent } from '../lib/contexts/PluginRegistry/lib/types'

function componentsMap(
  entries: Array<{ type: string; allowSoftBreak?: boolean }>
): Map<string, PluginRegistryComponent> {
  const map = new Map<string, PluginRegistryComponent>()
  for (const { type, allowSoftBreak } of entries) {
    map.set(type, {
      type,
      class: 'text',
      parent: null,
      componentEntry: {
        class: 'text',
        component: () => null,
        constraints: allowSoftBreak === undefined ? undefined : { allowSoftBreak }
      }
    } as unknown as PluginRegistryComponent)
  }
  return map
}

function makeEditor(
  children: Descendant[],
  components: Map<string, PluginRegistryComponent>
): Editor {
  const editor = createEditor()
  editor.children = children
  return withInsertSoftBreak(editor, components)
}

function paragraph(text: string, type = 'core/text'): Descendant {
  return {
    id: 'p1',
    type,
    class: 'text',
    properties: {},
    children: [{ text }]
  } as Descendant
}

describe('withInsertSoftBreak', () => {
  test('inserts a \\n at the cursor when the current element opts in', () => {
    const components = componentsMap([{ type: 'core/text', allowSoftBreak: true }])
    const editor = makeEditor([paragraph('hello world')], components)

    editor.selection = {
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 }
    }

    editor.insertSoftBreak()

    const leaf = (editor.children[0] as Element).children[0] as { text: string }
    expect(leaf.text).toBe('hello\n world')
  })

  test('no-op when the current element does not opt in (unset)', () => {
    const components = componentsMap([{ type: 'core/text' }])
    const editor = makeEditor([paragraph('hello world')], components)
    const before = JSON.parse(JSON.stringify(editor.children))

    editor.selection = {
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 }
    }

    editor.insertSoftBreak()

    expect(editor.children).toEqual(before)
  })

  test('no-op when the current element explicitly denies', () => {
    const components = componentsMap([{ type: 'core/text', allowSoftBreak: false }])
    const editor = makeEditor([paragraph('hello world')], components)
    const before = JSON.parse(JSON.stringify(editor.children))

    editor.selection = {
      anchor: { path: [0, 0], offset: 5 },
      focus: { path: [0, 0], offset: 5 }
    }

    editor.insertSoftBreak()

    expect(editor.children).toEqual(before)
  })

  test('an ancestor deny wins over a descendant opt-in', () => {
    const components = componentsMap([
      { type: 'test/caption', allowSoftBreak: true },
      { type: 'test/parent', allowSoftBreak: false }
    ])
    const editor = makeEditor([
      {
        id: 'wrapper',
        type: 'test/parent',
        class: 'block',
        children: [
          {
            id: 'cap',
            type: 'test/caption',
            class: 'text',
            children: [{ text: 'hello world' }]
          }
        ]
      } as Descendant
    ], components)
    const before = JSON.parse(JSON.stringify(editor.children))

    editor.selection = {
      anchor: { path: [0, 0, 0], offset: 5 },
      focus: { path: [0, 0, 0], offset: 5 }
    }

    editor.insertSoftBreak()

    expect(editor.children).toEqual(before)
  })

  test('no-op when there is no selection', () => {
    const components = componentsMap([{ type: 'core/text', allowSoftBreak: true }])
    const editor = makeEditor([paragraph('hello')], components)

    editor.selection = null
    editor.insertSoftBreak()

    const leaf = (editor.children[0] as Element).children[0] as { text: string }
    expect(leaf.text).toBe('hello')
  })

  test('replaces the selection when expanded before inserting the break', () => {
    const components = componentsMap([{ type: 'core/text', allowSoftBreak: true }])
    const editor = makeEditor([paragraph('hello world')], components)

    // Select "world" (positions 6-11)
    editor.selection = {
      anchor: { path: [0, 0], offset: 6 },
      focus: { path: [0, 0], offset: 11 }
    }

    editor.insertSoftBreak()

    const leaf = (editor.children[0] as Element).children[0] as { text: string }
    expect(leaf.text).toBe('hello \n')
  })
})
