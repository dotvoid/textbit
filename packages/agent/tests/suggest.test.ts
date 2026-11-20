import { describe, test, expect } from 'vitest'
import { Node, type Descendant, type Editor } from 'slate'
import * as Y from '@y/y'
import { createTextbitEditor, seedField, suggestedChanges, acceptChange } from '@dotvoid/textbit/headless'
import { Text, Bold } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent, createAgentTools } from '../lib'

const PLUGINS = [Text(), Bold()]
const paragraph = (id: string, text: string) =>
  ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant

// A shared document, a fork of it, and an agent suggesting in the fork
function setup() {
  const base = new Y.Doc({ gc: false })
  seedField(base.get('body'), [paragraph('aaaaaaaa-1', 'Spelling: teh mistake.'), paragraph('bbbbbbbb-2', 'Second.')])
  const fork = new Y.Doc({ gc: false, isSuggestionDoc: true })
  Y.applyUpdate(fork, Y.encodeStateAsUpdate(base))
  const renderer = Y.createDiffRenderer(base, fork)
  const content = createTextbitEditor({ plugins: PLUGINS, shared: base.get('body') })
  const forkEditor = createTextbitEditor({ plugins: PLUGINS, shared: fork.get('body') })
  const review = createTextbitEditor({ plugins: PLUGINS, shared: fork.get('body'), renderer })
  const agent = createDocumentAgent(content, { plugins: PLUGINS, review: 'suggest', suggestIn: forkEditor })
  return { content, review, agent }
}

const texts = (editor: Editor) => editor.children.map((n) => Node.string(n))

describe('an agent that suggests', () => {
  test('changes the fork, never the document, and a person accepts change by change', () => {
    const { content, review, agent } = setup()
    const result = agent.edit({ operations: [
      { op: 'replaceText', id: 'aaaaaa', find: 'teh', replace: 'the' },
      { op: 'insert', after: 'bbbbbb', content: '[text] Third.' }
    ] })
    expect(result).toMatchObject({ ok: true })
    expect(texts(content)).toEqual(['Spelling: teh mistake.', 'Second.'])

    const changes = suggestedChanges(review)
    expect(changes.map(({ kind, inserted, deleted, block }) => [kind, inserted, deleted, block])).toEqual([
      ['replace', 'the', 'teh', false],
      ['insert', 'Third.', '', true]
    ])
    acceptChange(review, changes[1])
    expect(texts(content)).toEqual(['Spelling: teh mistake.', 'Second.', 'Third.'])
  })

  test('tells the model so, and reads the fork with the suggestions made so far', () => {
    const { agent } = setup()
    const tools = createAgentTools(agent)
    const edit = tools.find((tool) => tool.name === 'document_edit')!
    expect(edit.description).toMatch(/^Suggest changes/)
    const text = edit.toText(edit.handler({ operations: [{ op: 'replaceText', id: 'aaaaaa', find: 'teh', replace: 'the' }] }))
    expect(text).toMatch(/^Suggested, for a person to accept or reject; the document has not changed/)
    const read = tools.find((tool) => tool.name === 'document_read')!
    const view = read.toText(read.handler({}))
    expect(view).toContain('This is the document with the suggestions made so far')
    expect(view).toContain('Spelling: the mistake.')
  })

  test('suggests moving a block too', () => {
    const { content, review, agent } = setup()
    expect(agent.edit({ operations: [{ op: 'move', id: 'bbbbbb', before: 'aaaaaa' }] })).toMatchObject({ ok: true })
    expect(texts(content)).toEqual(['Spelling: teh mistake.', 'Second.'])
    expect(suggestedChanges(review).map((change) => [change.kind, change.block])).toEqual([['insert', true], ['delete', true]])
  })

  test('without a fork it cannot suggest, and back to applying it edits the document', () => {
    const content = createTextbitEditor({ plugins: PLUGINS, value: [paragraph('aaaaaaaa-1', 'Spelling: teh mistake.')] })
    const agent = createDocumentAgent(content, { plugins: PLUGINS, review: 'suggest' })
    expect(agent.edit({ operations: [{ op: 'replaceText', id: 'aaaaaa', find: 'teh', replace: 'the' }] }))
      .toMatchObject({ ok: false, error: { code: 'not-allowed' } })

    agent.context.options.review = 'apply'
    expect(agent.edit({ operations: [{ op: 'replaceText', id: 'aaaaaa', find: 'teh', replace: 'the' }] })).toMatchObject({ ok: true })
    expect(texts(content)).toEqual(['Spelling: the mistake.'])
  })
})
