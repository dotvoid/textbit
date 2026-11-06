import { describe, test, expect } from 'vitest'
import { act } from '@testing-library/react'
import { Editor, Transforms, type Element } from 'slate'
import { Bold, Code, Italic, Strikethrough, Text, Underline } from '../lib'
import { renderEditor, settle } from './_editor'

describe('Text', () => {
  test('headings use the editor format: role heading-N, rendered as hN', async () => {
    const { editor, container, run } = renderEditor([Text()])
    act(() => Transforms.select(editor, Editor.start(editor, [])))

    run('base/text/set-heading-2')
    await settle()

    expect((editor.children[0] as Element).properties?.role).toBe('heading-2')
    expect(container.querySelector('h2')?.textContent).toBe('Hello world')
  })

  test('a paragraph has no role, as in the built-in text plugin', async () => {
    const { editor, container, run } = renderEditor([Text()])
    act(() => Transforms.select(editor, Editor.start(editor, [])))

    run('base/text/set-heading-1')
    run('base/text/set-paragraph')
    await settle()

    expect((editor.children[0] as Element).properties?.role).toBeUndefined()
    expect(container.querySelector('p.tb-paragraph')?.textContent).toBe('Hello world')
  })

  test('offers headings 1 to 4 by default, or the levels asked for', () => {
    const names = (opts?: Parameters<typeof Text>[0]) => Text(opts).actions?.map((a) => a.name)

    expect(names()).toEqual(['set-paragraph', 'set-heading-1', 'set-heading-2', 'set-heading-3', 'set-heading-4', 'set-preamble'])
    expect(names({ headings: [2, 3] })).toEqual(['set-paragraph', 'set-heading-2', 'set-heading-3', 'set-preamble'])
    expect(names({ headings: [1, 2], preamble: false })).toEqual(['set-paragraph', 'set-heading-1', 'set-heading-2'])
  })

  test('a lead-in has the role preamble and renders as a paragraph', async () => {
    const { editor, container, run } = renderEditor([Text()])
    act(() => Transforms.select(editor, Editor.start(editor, [])))

    run('base/text/set-preamble')
    await settle()

    expect((editor.children[0] as Element).properties?.role).toBe('preamble')
    expect(container.querySelector('p.tb-text.tb-preamble')?.textContent).toBe('Hello world')
    expect(Text().actions?.find((a) => a.name === 'set-preamble')).toMatchObject({ title: 'Lead-in', hotkey: undefined })
  })

  test('titles, placeholders and shortcuts can be replaced', () => {
    const plugin = Text({
      titles: { 'heading-1': 'Rubrik 1' },
      placeholders: { 'heading-1': 'Skriv en rubrik' },
      hotkeys: { 'heading-1': false, 'heading-2': 'mod+alt+h' }
    })
    const action = (name: string) => plugin.actions?.find((a) => a.name === name)

    expect(action('set-heading-1')?.title).toBe('Rubrik 1')
    expect(action('set-heading-2')?.title).toBe('Heading 2')
    expect(action('set-heading-1')?.hotkey).toBeUndefined()
    expect(action('set-heading-2')?.hotkey).toBe('mod+alt+h')
    expect(action('set-heading-3')?.hotkey).toBe('mod+alt+3')

    const placeholder = (plugin.componentEntry as { placeholder: (e: Element) => string }).placeholder
    expect(placeholder({ type: 'base/text', properties: { role: 'heading-1' } } as Element)).toBe('Skriv en rubrik')
  })

  test('a single line text allows no breaks', () => {
    const constraints = (Text({ singleLine: true }).componentEntry as unknown as { constraints: Record<string, boolean> }).constraints
    expect(constraints.allowBreak).toBe(false)
    expect(constraints.allowSoftBreak).toBe(false)
  })
})

describe('formatting marks', () => {
  test.each([
    ['Bold', Bold, 'base/bold', 'font-weight: bold'],
    ['Italic', Italic, 'base/italic', 'font-style: italic'],
    ['Underline', Underline, 'base/underline', 'text-decoration: underline'],
    ['Strikethrough', Strikethrough, 'base/strikethrough', 'text-decoration: line-through']
  ] as const)('%s marks the selection and styles itself without a stylesheet', async (_label, plugin, mark, css) => {
    const { editor, container, run } = renderEditor([Text(), plugin()])
    act(() => Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 5 } }))

    const action = plugin().actions![0]
    run(`${mark}/${action.name}`)
    // The handler accepts textbit's default, which is to toggle the mark
    act(() => Editor.addMark(editor, mark, true))
    await settle()

    expect(Editor.marks(editor)?.[mark]).toBe(true)
    expect(container.querySelector(`[style*="${css.split(':')[0]}"]`)?.getAttribute('style')).toContain(css)
  })

  test('Code renders with the tb-code class, for a stylesheet to style', async () => {
    const { editor, container } = renderEditor([Text(), Code()])
    act(() => Transforms.select(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 5 } }))
    act(() => Editor.addMark(editor, 'base/code', true))
    await settle()

    expect(container.querySelector('.tb-code')?.textContent).toBe('Hello')
  })

  test('shortcuts can be replaced or removed, and titles translated', () => {
    expect(Bold().actions![0].hotkey).toBe('mod+b')
    expect(Bold({ hotkey: false }).actions![0].hotkey).toBeUndefined()
    expect(Bold({ hotkey: 'mod+alt+b' }).actions![0].hotkey).toBe('mod+alt+b')
    expect(Bold({ title: 'Fet' }).actions![0].title).toBe('Fet')
  })

  test('replace the built-in marks by name, so existing documents keep working', () => {
    expect([Bold(), Italic(), Underline()].map((p) => p.name)).toEqual(['base/bold', 'base/italic', 'base/underline'])
  })
})
