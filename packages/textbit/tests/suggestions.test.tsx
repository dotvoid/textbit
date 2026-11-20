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

  test('split by author, though accepting one takes the whole run Y.js sees', () => {
    const { suggester, content } = byTwo((suggest) => {
      suggest('person:alice', (block) => block.delete(4, 3))
      suggest('person:bob', (block) => block.insert(4, 'the'))
    })
    const changes = suggestedChanges(suggester)
    const listed = changes.map(({ kind, inserted, deleted, by }) => [kind, inserted, deleted, by])
    expect(listed).toEqual([
      ['delete', '', 'teh', 'person:alice'],
      ['insert', 'the', '', 'person:bob']
    ])

    // Y.js widens to the contiguous run of suggested content, whoever made
    // it, even given where the change ends: Bob's goes in with Alice's
    acceptChange(suggester, changes[0])
    expect(text(content)).toBe('Fix the typo.')
    expect(suggestedChanges(suggester)).toEqual([])
  })

  test('accepting one author\'s change leaves another apart from it', () => {
    const { suggester, content } = byTwo((suggest) => {
      suggest('person:alice', (block) => block.delete(4, 3))
      suggest('person:bob', (block) => block.insert(5, 'big '))
    })
    acceptChange(suggester, suggestedChanges(suggester)[0])
    expect(text(content)).toBe('Fix  typo.')
    expect(suggestedChanges(suggester).map(({ inserted, by }) => [inserted, by])).toEqual([
      ['big ', 'person:bob']
    ])
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

// "Fix teh typo." and its fork, where two people suggest, each in a copy of
// the fork so the attributions can name who made which items
function byTwo(edits: (suggest: (who: string, edit: (block: Y.Node) => void) => void) => void) {
  const base = new Y.Doc({ gc: false })
  seedField(base.get('body'), [paragraph('p1', 'Fix teh typo.')])
  const fork = new Y.Doc({ gc: false, isSuggestionDoc: true })
  Y.applyUpdate(fork, Y.encodeStateAsUpdate(base))
  const attributions = Y.createContentMap()
  const renderer = Y.createDiffRenderer(base, fork, { attributions })
  edits((who, edit) => {
    const copy = new Y.Doc({ gc: false, isSuggestionDoc: true })
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(fork))
    const before = Y.encodeStateVector(copy)
    let ids = Y.createContentIds(Y.createIdSet(), Y.createIdSet())
    copy.on('afterTransaction', (tr: { insertSet: Y.IdSet, deleteSet: Y.IdSet }) => {
      ids = Y.createContentIds(tr.insertSet, tr.deleteSet)
    })
    copy.transact(() => edit(copy.get('body').get(0) as Y.Node))
    const made = Y.createContentMapFromContentIds(ids, [Y.createContentAttribute('insert', who)], [
      Y.createContentAttribute('delete', who)
    ])
    Y.insertIntoIdMap(attributions.inserts, made.inserts)
    Y.insertIntoIdMap(attributions.deletes, made.deletes)
    Y.applyUpdate(fork, Y.encodeStateAsUpdate(copy, before))
  })
  const suggester = createTextbitEditor({ shared: fork.get('body'), renderer })
  const content = createTextbitEditor({ shared: base.get('body') })
  return { suggester, content }
}

// The end of the first paragraph, in its last leaf
function endOf(editor: Editor) {
  const leaves = (editor.children[0] as { children: Array<{ text: string }> }).children
  const last = leaves.length - 1
  return { path: [0, last], offset: leaves[last].text.length }
}
