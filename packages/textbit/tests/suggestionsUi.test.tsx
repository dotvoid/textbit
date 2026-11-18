import { describe, test, expect } from 'vitest'
import { render, act, fireEvent, screen } from '@testing-library/react'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import { useSlateStatic } from 'slate-react'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { Suggestions } from '../lib/components/Suggestions'
import { suggestionFor, suggestionStore } from '../lib/suggestions'
import axe from 'axe-core'

const p = (id: string, text: string) => ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant

const before = [p('a', 'Spelling: teh mistake.'), p('b', 'Remove me.')]
const after = [p('a', 'Spelling: the mistake.'), p('n', 'A new paragraph.')]

function Grab({ into }: { into: { editor?: Editor } }) {
  into.editor = useSlateStatic()
  return null
}

async function setup(readOnly = false) {
  const into: { editor?: Editor } = {}
  const utils = render(
    <TextbitRoot value={structuredClone(before)} readOnly={readOnly}>
      <Grab into={into} />
      <TextbitEditable aria-label='Document' />
      <Suggestions />
    </TextbitRoot>
  )
  const editor = into.editor!
  const suggestion = suggestionFor(before, after, { name: 'Assistant', color: 'rgb(0, 128, 0)' })!
  await act(async () => {
    suggestionStore(editor).put(suggestion)
  })
  return { ...utils, editor, suggestion }
}

describe('suggestions in the editor', () => {
  test('show what they would change, and wait', async () => {
    const { container } = await setup()
    const struck = (id: string) => [...container.querySelectorAll(`[data-id="${id}"] .tb-suggested-delete [data-slate-string]`)].map((e) => e.textContent).join('')
    expect([struck('a'), struck('b')]).toEqual(['teh', 'Remove me.'])
    expect(container.querySelector('[data-tb="suggested-text"]')?.textContent).toBe('the')
    expect(container.querySelector('[data-tb="suggested-block"]')?.textContent).toContain('A new paragraph.')
    expect(container.querySelectorAll('[data-tb="suggestion-bar"]')).toHaveLength(3)
    expect(screen.getByRole('region', { name: 'Suggestions' }).textContent).toContain('Change “teh” to “the”')
  })

  test('accepting a block makes the change and removes its marks', async () => {
    const { container, editor } = await setup()
    const bar = container.querySelector('[data-id="a"] [data-tb="suggestion-bar"]')!
    await act(async () => {
      fireEvent.click(bar.querySelector('[data-tb="suggestion-accept"]')!)
    })
    expect(Node.string(editor.children[0])).toBe('Spelling: the mistake.')
    expect(container.querySelector('[data-tb="suggested-text"]')).toBeNull()
    expect(container.querySelectorAll('[data-tb="suggestion-bar"]')).toHaveLength(2)
  })

  test('the list accepts and rejects all at once', async () => {
    const { editor, container } = await setup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept (3)' }))
    })
    expect(editor.children.map((n) => Node.string(n))).toEqual(['Spelling: the mistake.', 'A new paragraph.'])
    expect(container.querySelector('[data-tb="suggestions"]')).toBeNull()
  })

  test('rejecting leaves the document as it is', async () => {
    const { editor, suggestion } = await setup()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject (3)' }))
    })
    expect(editor.children.map((n) => Node.string(n))).toEqual(['Spelling: teh mistake.', 'Remove me.'])
    expect(suggestionStore(editor).get(suggestion.id)).toBeUndefined()
  })

  test('a block changed since can only be rejected', async () => {
    const { editor, container } = await setup()
    await act(async () => {
      Transforms.insertText(editor, '!', { at: Editor.end(editor, [0]) })
    })
    const bar = container.querySelector('[data-id="a"] [data-tb="suggestion-bar"]')!
    expect(bar.getAttribute('data-state')).toBe('stale')
    expect(bar.querySelector('[data-tb="suggestion-accept"]')).toBeNull()
    expect(bar.querySelector('[data-tb="suggestion-reject"]')).not.toBeNull()
  })

  test('read-only shows them without buttons', async () => {
    const { container } = await setup(true)
    expect(container.querySelectorAll('[data-tb="suggestion-bar"]')).toHaveLength(3)
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})

test('the editor with suggestions and their list has no accessibility violations', async () => {
  const { container } = await setup()
  const results = await axe.run(container, {
    // jsdom has no layout, so contrast and size checks cannot run
    rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } }
  })
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
})
