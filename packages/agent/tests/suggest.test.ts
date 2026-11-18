import { describe, test, expect } from 'vitest'
import { Editor, Node, type Descendant } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slateNodesToInsertDelta } from '@slate-yjs/core'
import { createTextbitEditor, suggestionStore, acceptSuggestedBlock } from '@dotvoid/textbit/headless'
import { Text, Bold } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent, createAgentTools } from '../lib'

const PLUGINS = [Text(), Bold()]
const paragraph = (id: string, text: string) =>
  ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant

function setup() {
  const editor = createTextbitEditor({ plugins: PLUGINS, value: [paragraph('aaaaaaaa-1', 'Spelling: teh mistake.'), paragraph('bbbbbbbb-2', 'Second.')] })
  const agent = createDocumentAgent(editor, { plugins: PLUGINS, review: 'suggest', author: { name: 'Assistant', color: 'green' } })
  return { editor, agent }
}

describe('an agent that suggests', () => {
  test('leaves the document as it is and stores a suggestion, block by block', () => {
    const { editor, agent } = setup()
    const result = agent.edit({ operations: [
      { op: 'replaceText', id: 'aaaaaa', find: 'teh', replace: 'the' },
      { op: 'insert', after: 'bbbbbb', content: '[text] Third.' }
    ] })
    expect(result).toMatchObject({ ok: true })
    expect(editor.children.map((n) => Node.string(n))).toEqual(['Spelling: teh mistake.', 'Second.'])

    const [suggestion] = suggestionStore(editor).list()
    expect(suggestion.author).toEqual({ name: 'Assistant', color: 'green' })
    expect(suggestion.blocks.map((block) => block.kind)).toEqual(['change', 'insert'])
    expect(result.ok && result.suggestion).toBe(suggestion.id)
    expect(result.ok && result.view).toMatch(/^\[#aaaaaa text\] Spelling: the mistake\.\n\[#\w+ text\] Third\.$/)
  })

  test('tells the model so, and how many wait', () => {
    const { agent } = setup()
    const tools = createAgentTools(agent)
    const edit = tools.find((tool) => tool.name === 'document_edit')!
    expect(edit.description).toMatch(/^Suggest changes/)
    const text = edit.toText(edit.handler({ operations: [{ op: 'replaceText', id: 'aaaaaa', find: 'teh', replace: 'the' }] }))
    expect(text).toMatch(/^Suggested, for a person to accept or reject; the document has not changed/)
    const read = tools.find((tool) => tool.name === 'document_read')!
    expect(read.toText(read.handler({}))).toContain('1 suggestion waiting for review')
  })

  test('cannot suggest a move yet', () => {
    const { agent } = setup()
    expect(agent.edit({ operations: [{ op: 'move', id: 'bbbbbb', before: 'aaaaaa' }] }))
      .toMatchObject({ ok: false, error: { code: 'not-allowed' } })
  })

  test('in a shared document, a person elsewhere accepts it', () => {
    const doc = new Y.Doc()
    doc.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta([paragraph('aaaaaaaa-1', 'Spelling: teh mistake.')]))
    const personDoc = new Y.Doc()
    Y.applyUpdate(personDoc, Y.encodeStateAsUpdate(doc))
    const server = createTextbitEditor({ plugins: PLUGINS, shared: doc.get('content', Y.XmlText) })
    const person = createTextbitEditor({ plugins: PLUGINS, shared: personDoc.get('content', Y.XmlText) })
    YjsEditor.connect(server as YjsEditor & Editor)
    YjsEditor.connect(person as YjsEditor & Editor)

    const agent = createDocumentAgent(server, { plugins: PLUGINS, review: 'suggest' })
    agent.edit({ operations: [{ op: 'replaceText', id: 'aaaaaa', find: 'teh', replace: 'the' }] })
    Y.applyUpdate(personDoc, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(personDoc)))

    const [suggestion] = suggestionStore(person).list()
    expect(acceptSuggestedBlock(person, suggestion.id, 'aaaaaaaa-1')).toEqual({ ok: true })
    YjsEditor.flushLocalChanges(person as YjsEditor & Editor)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(personDoc, Y.encodeStateVector(doc)))
    expect(Node.string(server.children[0])).toBe('Spelling: the mistake.')
    expect(suggestionStore(server).list()).toEqual([])
  })
})
