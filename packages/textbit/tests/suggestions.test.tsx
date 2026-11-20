import { describe, expect, test } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import * as Y from '@y/y'
import { Node, Transforms, type Descendant, type Editor } from 'slate'
import { createTextbitEditor } from '../lib/editor/createTextbitEditor'
import { seedField } from '../lib/yjs/model'
import { acceptChange, rejectChange, suggestedChanges } from '../lib/suggestions/changes'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { Suggestions } from '../lib/components/Suggestions'

const paragraph = (id: string, text: string): Descendant =>
  ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant

// The shared text, a fork of it to suggest in, and an editor on each
function forked(blocks: Descendant[] = [paragraph('p1', 'Write 600 words.')]) {
  const base = new Y.Doc({ gc: false })
  seedField(base.get('body'), blocks)
  const fork = new Y.Doc({ gc: false, isSuggestionDoc: true })
  Y.applyUpdate(fork, Y.encodeStateAsUpdate(base))
  const renderer = Y.createDiffRenderer(base, fork)
  const suggester = createTextbitEditor({ shared: fork.get('body'), renderer })
  const content = createTextbitEditor({ shared: base.get('body') })
  return { base, fork, renderer, suggester, content }
}

const text = (editor: Editor) => editor.children.map((block) => Node.string(block)).join('|')

describe('suggested changes in a fork', () => {
  test('read off the text: added, removed and replaced, side by side as one', () => {
    const { suggester } = forked([paragraph('p1', 'Write 600 words today.')])
    Transforms.insertText(suggester, 'about ', { at: { path: [0, 0], offset: 'Write '.length } })
    // "today" replaced by "tonight", apart from it
    const leafWith = (needle: string) => (suggester.children[0] as { children: Array<{ text: string }> }).children.findIndex((leaf) => leaf.text.includes(needle))
    const last = leafWith('today')
    const from = (suggester.children[0] as { children: Array<{ text: string }> }).children[last].text.indexOf('today')
    Transforms.delete(suggester, { at: { anchor: { path: [0, last], offset: from }, focus: { path: [0, last], offset: from + 5 } } })
    const struck = leafWith('today')
    Transforms.insertText(suggester, 'tonight', { at: { path: [0, struck + 1], offset: 0 } })

    expect(suggestedChanges(suggester).map(({ kind, inserted, deleted: removed, block }) => [kind, inserted, removed, block])).toEqual([
      ['insert', 'about ', '', false],
      ['replace', 'tonight', 'today', false]
    ])
  })

  test('accepted one at a time into the shared text, the other still suggested', () => {
    const { suggester, content } = forked([paragraph('p1', 'Write 600 words.')])
    Transforms.insertText(suggester, 'Please ', { at: { path: [0, 0], offset: 0 } })
    Transforms.insertText(suggester, ' Today.', { at: endOf(suggester) })
    const [first, second] = suggestedChanges(suggester)

    acceptChange(suggester, second)
    expect(text(content)).toBe('Write 600 words. Today.')
    expect(suggestedChanges(suggester).map((change) => change.inserted)).toEqual(['Please '])

    rejectChange(suggester, suggestedChanges(suggester)[0])
    expect(text(content)).toBe('Write 600 words. Today.')
    expect(suggestedChanges(suggester)).toEqual([])
    expect(first.kind).toBe('insert')
  })

  test('a suggested paragraph is one change, accepted with the paragraph', () => {
    const { suggester, content } = forked([paragraph('p1', 'Harbour.')])
    Transforms.insertNodes(suggester, paragraph('p2', 'Boats.'), { at: [1] })

    const changes = suggestedChanges(suggester)
    expect(changes.map(({ kind, inserted, block }) => [kind, inserted, block])).toEqual([['insert', 'Boats.', true]])
    acceptChange(suggester, changes[0])
    expect(text(content)).toBe('Harbour.|Boats.')
  })

  test('none without a fork', () => {
    expect(suggestedChanges(createTextbitEditor({ value: [paragraph('p1', 'Hi')] }))).toEqual([])
  })
})

describe('Textbit.Suggestions', () => {
  test('lists the changes, by name, to accept and reject', async () => {
    const { fork, renderer, content } = forked([paragraph('p1', 'Write 600 words.')])
    const { container } = render(
      <TextbitRoot value={fork.get('body')} renderer={renderer}>
        <TextbitEditable aria-label='Text' />
        <Suggestions people={{ 'person:sam': { name: 'Sam' } }} />
      </TextbitRoot>
    )
    expect(container.querySelector('[data-tb-view="suggestions"]')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Suggestions' })).toBeNull()

    const suggester = createTextbitEditor({ shared: fork.get('body'), renderer })
    act(() => Transforms.insertText(suggester, 'Please ', { at: { path: [0, 0], offset: 0 } }))
    await act(async () => {})

    const list = screen.getByRole('region', { name: 'Suggestions' })
    expect(within(list).getByText('Someone adds “Please ”')).toBeTruthy()
    expect(container.querySelector('[data-tb-change="insert"]')?.textContent).toBe('Please ')

    act(() => {
      fireEvent.click(within(list).getByRole('button', { name: 'Accept: Someone adds “Please ”' }))
    })
    await act(async () => {})
    expect(text(content)).toBe('Please Write 600 words.')
    expect(screen.queryByRole('region', { name: 'Suggestions' })).toBeNull()
  })
})

// The end of the first paragraph, in its last leaf
function endOf(editor: Editor) {
  const leaves = (editor.children[0] as { children: Array<{ text: string }> }).children
  const last = leaves.length - 1
  return { path: [0, last], offset: leaves[last].text.length }
}
