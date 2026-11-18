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

describe('suggestions with several people', () => {
  const peer = (doc: Y.Doc) => {
    const editor = createTextbitEditor({ shared: doc.get('content', Y.XmlText) }) as YjsEditor & Editor
    YjsEditor.connect(editor)
    return editor
  }
  const sync = (a: Y.Doc, b: Y.Doc) => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  }
  function two() {
    const base = new Y.Doc()
    base.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta([p('a', 'Spelling: teh mistake.'), p('z', 'Last.')]))
    const A = new Y.Doc()
    const B = new Y.Doc()
    sync(base, A)
    sync(base, B)
    const a = peer(A)
    const b = peer(B)
    // Suggested from elsewhere, as an agent does
    const agentDoc = new Y.Doc()
    sync(base, agentDoc)
    const agent = peer(agentDoc)
    const suggestion = suggestionFor(agent.children as Descendant[], [p('a', 'Spelling: the mistake.'), p('z', 'Last.')], AUTHOR)!
    suggestionStore(agent).put(suggestion)
    sync(agentDoc, A)
    sync(A, B)
    return { A, B, a, b, suggestion }
  }

  test('two accepting the same block at once end up with it once', () => {
    const { A, B, a, b, suggestion } = two()
    expect(acceptSuggestedBlock(a, suggestion.id, 'a')).toEqual({ ok: true })
    expect(acceptSuggestedBlock(b, suggestion.id, 'a')).toEqual({ ok: true })
    YjsEditor.flushLocalChanges(a)
    YjsEditor.flushLocalChanges(b)
    sync(A, B)
    YjsEditor.flushLocalChanges(a)
    YjsEditor.flushLocalChanges(b)
    sync(A, B)

    for (const editor of [a, b]) {
      expect(editor.children.map((n) => Node.string(n))).toEqual(['Spelling: the mistake.', 'Last.'])
    }
    expect(suggestionStore(a).list()).toEqual([])
  })

  test('once one has accepted and it has reached the other, the other cannot', () => {
    const { A, B, a, b, suggestion } = two()
    acceptSuggestedBlock(a, suggestion.id, 'a')
    YjsEditor.flushLocalChanges(a)
    sync(A, B)
    expect(acceptSuggestedBlock(b, suggestion.id, 'a')).toEqual({ ok: false, reason: 'gone' })
  })

  test('blocks that share an id but differ are both kept', () => {
    const editor = createTextbitEditor({ value: [p('a', 'One'), p('a', 'One, edited'), p('a', 'One')] })
    Editor.normalize(editor, { force: true })
    expect(editor.children.map((n) => Node.string(n))).toEqual(['One', 'One, edited'])
  })

  test('a reject can be undone by the person who rejected', async () => {
    const { a, suggestion } = two()
    rejectSuggestedBlock(a, suggestion.id, 'a')
    expect(suggestionStore(a).list()).toEqual([])
    a.undo()
    expect(suggestionStore(a).get(suggestion.id)?.blocks.map((block) => block.id)).toEqual(['a'])
  })

  test('undoing an accept brings back the text and the suggestion', async () => {
    const { a, suggestion } = two()
    acceptSuggestedBlock(a, suggestion.id, 'a')
    YjsEditor.flushLocalChanges(a)
    a.undo()
    expect(Node.string(a.children[0])).toBe('Spelling: teh mistake.')
    expect(suggestionStore(a).get(suggestion.id)).toBeDefined()
  })
})

describe('decisions on a suggestion by several people', () => {
  const sync = (a: Y.Doc, b: Y.Doc) => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
  }
  const peer = (doc: Y.Doc) => {
    const editor = createTextbitEditor({ shared: doc.get('content', Y.XmlText) }) as YjsEditor & Editor
    YjsEditor.connect(editor)
    return editor
  }
  function three() {
    const before = [p('a', 'Spelling: teh mistake.'), p('b', 'Second.'), p('c', 'Third.')]
    const base = new Y.Doc()
    base.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta(structuredClone(before)))
    const docs = [new Y.Doc(), new Y.Doc(), new Y.Doc()]
    docs.forEach((doc) => sync(base, doc))
    const [agent, alice, bob] = docs.map(peer)
    const suggestion = suggestionFor(before, [p('a', 'Spelling: the mistake.'), p('b', 'Second!'), p('c', 'Third!')], AUTHOR)!
    suggestionStore(agent).put(suggestion)
    sync(docs[0], docs[1])
    sync(docs[0], docs[2])
    return { docs, alice, bob, suggestion }
  }

  test('two people deciding different blocks at once both count', () => {
    const { docs, alice, bob, suggestion } = three()
    rejectSuggestedBlock(alice, suggestion.id, 'b')
    rejectSuggestedBlock(bob, suggestion.id, 'c')
    sync(docs[1], docs[2])
    expect(suggestionStore(alice).get(suggestion.id)?.blocks.map((block) => block.id)).toEqual(['a'])
  })

  test('undoing an accept brings its block back, whatever others decided after', () => {
    const { docs, alice, bob, suggestion } = three()
    acceptSuggestedBlock(bob, suggestion.id, 'a')
    YjsEditor.flushLocalChanges(bob)
    sync(docs[2], docs[1])
    rejectSuggestedBlock(alice, suggestion.id, 'c')
    sync(docs[1], docs[2])

    bob.undo()
    expect(Node.string(bob.children[0])).toBe('Spelling: teh mistake.')
    expect(suggestionStore(bob).get(suggestion.id)?.blocks.map((block) => block.id)).toEqual(['a', 'b'])
  })
})
