// @vitest-environment node
import { describe, test, expect } from 'vitest'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slateNodesToInsertDelta } from '@slate-yjs/core'
import { createTextbitEditor } from '../lib/editor/createTextbitEditor'
import {
  suggestionFor, suggestionStore, suggestedBlockState, suggestedTextChanges,
  acceptSuggestedBlock, rejectSuggestedBlock, acceptSuggestion
} from '../lib/suggestions'
import { hashNode } from '../lib/utils/hashNode'

const p = (id: string, text: string) => ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant
const AUTHOR = { name: 'Assistant' }

function editorWith(document: Descendant[]) {
  return createTextbitEditor({ value: structuredClone(document) })
}

const strings = (editor: Editor) => editor.children.map((n) => Node.string(n))

describe('a suggestion', () => {
  const before = [p('a', 'Spelling: teh mistake.'), p('b', 'Remove me.'), p('c', 'Last.')]
  const after = [p('a', 'Spelling: the mistake.'), p('n1', 'New one.'), p('n2', 'New two.'), p('c', 'Last.')]

  test('says block by block what changes, is inserted and deleted', () => {
    const suggestion = suggestionFor(before, after, AUTHOR)!
    expect(suggestion.blocks.map((block) => [block.kind, block.id, block.kind === 'insert' ? block.after : undefined])).toEqual([
      ['change', 'a', undefined],
      ['insert', 'n1', 'a'],
      ['insert', 'n2', 'n1'],
      ['delete', 'b', undefined]
    ])
    expect(suggestionFor(before, before, AUTHOR)).toBeNull()
  })

  test('is accepted block by block, the inserted in order, and is gone when settled', () => {
    const editor = editorWith(before)
    const store = suggestionStore(editor)
    const suggestion = suggestionFor(before, after, AUTHOR)!
    store.put(suggestion)

    // The second insert first: it goes after its anchor's anchor until that is in
    expect(acceptSuggestedBlock(editor, suggestion.id, 'n2')).toEqual({ ok: true })
    expect(acceptSuggestedBlock(editor, suggestion.id, 'n1')).toEqual({ ok: true })
    expect(strings(editor)).toEqual(['Spelling: teh mistake.', 'New one.', 'New two.', 'Remove me.', 'Last.'])

    rejectSuggestedBlock(editor, suggestion.id, 'b')
    expect(acceptSuggestion(editor, suggestion.id)).toEqual([])
    expect(strings(editor)).toEqual(['Spelling: the mistake.', 'New one.', 'New two.', 'Remove me.', 'Last.'])
    expect(store.list()).toEqual([])
  })

  test('cannot be accepted where the block changed since', () => {
    const editor = editorWith(before)
    const suggestion = suggestionFor(before, after, AUTHOR)!
    suggestionStore(editor).put(suggestion)
    Transforms.insertText(editor, '!', { at: Editor.end(editor, [0]) })

    const change = suggestion.blocks[0]
    expect(suggestedBlockState(editor, suggestion, change)).toBe('stale')
    expect(acceptSuggestedBlock(editor, suggestion.id, 'a')).toEqual({ ok: false, reason: 'stale' })
    expect(strings(editor)[0]).toBe('Spelling: teh mistake.!')
  })

  test('shows its words against the text as it is', () => {
    const { texts, formatting } = suggestedTextChanges(before[0] as never, after[0] as never)
    expect([...texts]).toEqual([['a', [{ at: 10, from: 10, added: 'the', removed: 'teh' }]]])
    expect(formatting).toBe(false)

    const bold = { ...(before[0] as object), children: [{ text: 'Spelling: teh mistake.', 'base/bold': true }] }
    expect(suggestedTextChanges(before[0] as never, bold as never).formatting).toBe(true)
  })

  test('hashes alike whatever order the properties come in', () => {
    expect(hashNode({ id: 'a', type: 't', children: [{ text: 'x' }] })).toBe(hashNode({ children: [{ text: 'x' }], type: 't', id: 'a' }))
  })

  test('in a shared document, every peer sees it', () => {
    const doc = new Y.Doc()
    doc.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta(structuredClone(before)))
    const other = new Y.Doc()
    const one = createTextbitEditor({ shared: doc.get('content', Y.XmlText) })
    const two = createTextbitEditor({ shared: other.get('content', Y.XmlText) })
    YjsEditor.connect(one as YjsEditor & Editor)

    const suggestion = suggestionFor(before, after, AUTHOR)!
    suggestionStore(one).put(suggestion)
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    YjsEditor.connect(two as YjsEditor & Editor)

    expect(suggestionStore(two).get(suggestion.id)?.blocks).toHaveLength(4)
    expect(acceptSuggestedBlock(two, suggestion.id, 'a')).toEqual({ ok: true })
    YjsEditor.flushLocalChanges(two as YjsEditor & Editor)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)))
    expect(Node.string(one.children[0])).toBe('Spelling: the mistake.')
    expect(suggestionStore(one).get(suggestion.id)?.blocks.map((b) => b.id)).toEqual(['n1', 'n2', 'b'])
  })
})
