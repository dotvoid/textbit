import { describe, test, expect } from 'vitest'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slateNodesToInsertDelta } from '@slate-yjs/core'
import { createTextbitEditor, AGENT_PRESENCE_FIELD } from '@dotvoid/textbit/headless'
import { Text, Bold } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent, createAgentPresence } from '../lib'

const PLUGINS = [Text(), Bold()]
const paragraph = (id: string, text: string) =>
  ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant

function sharedEditor(doc: Y.Doc) {
  const editor = createTextbitEditor({ plugins: PLUGINS, shared: doc.get('content', Y.XmlText) })
  YjsEditor.connect(editor as YjsEditor & Editor)
  return editor
}

function seeded() {
  const doc = new Y.Doc()
  doc.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta([
    paragraph('11111111-a', 'One'),
    paragraph('22222222-b', 'Two')
  ]))
  return doc
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

const strings = (editor: Editor) => editor.children.map((n) => Node.string(n))

describe('a run of agent edits', () => {
  test('in a shared document, undoes the run and keeps what a person wrote meanwhile', () => {
    const base = seeded()
    const personDoc = new Y.Doc()
    const agentDoc = new Y.Doc()
    sync(base, personDoc)
    sync(base, agentDoc)
    const person = sharedEditor(personDoc)
    const agent = createDocumentAgent(sharedEditor(agentDoc), { plugins: PLUGINS })

    const run = agent.startRun()
    expect(agent.edit({ operations: [{ op: 'replaceText', id: '22222222', find: 'Two', replace: 'Second' }] }).ok).toBe(true)
    sync(agentDoc, personDoc)

    Transforms.insertText(person, ' by a person', { at: Editor.end(person, [0]) })
    YjsEditor.flushLocalChanges(person as YjsEditor & Editor)
    sync(personDoc, agentDoc)

    expect(agent.edit({ operations: [{ op: 'insert', content: '[text] Third' }] }).ok).toBe(true)
    run.finish()
    expect(run.edits).toBe(2)

    expect(run.undo()).toEqual({ ok: true })
    sync(agentDoc, personDoc)
    expect(strings(person)).toEqual(['One by a person', 'Two'])
  })

  test('the undo of the person at the same editor leaves the agent\'s edits', () => {
    const editor = sharedEditor(seeded())
    const agent = createDocumentAgent(editor, { plugins: PLUGINS })

    Transforms.insertText(editor, '!', { at: Editor.end(editor, [0]) })
    YjsEditor.flushLocalChanges(editor as YjsEditor & Editor)
    expect(agent.edit({ operations: [{ op: 'replaceText', id: '22222222', find: 'Two', replace: 'Agent' }] }).ok).toBe(true)

    editor.undo()
    expect(strings(editor)).toEqual(['One', 'Agent'])
  })

  test('without sharing, undoes while nobody else changed the document', () => {
    const editor = createTextbitEditor({ plugins: PLUGINS, value: [paragraph('a', 'One'), paragraph('b', 'Two')] })
    const agent = createDocumentAgent(editor, { plugins: PLUGINS })

    const run = agent.startRun()
    agent.edit({ operations: [{ op: 'insert', content: '[text] Three' }, { op: 'delete', id: '@0' }] })
    expect(strings(editor)).toEqual(['Two', 'Three'])
    expect(run.undo()).toEqual({ ok: true })
    expect(strings(editor)).toEqual(['One', 'Two'])

    const second = agent.startRun()
    agent.edit({ operations: [{ op: 'insert', content: '[text] Three' }] })
    Transforms.insertText(editor, '?', { at: Editor.end(editor, [0]) })
    expect(second.undo()).toMatchObject({ ok: false })
  })
})

describe('presence', () => {
  test('follows the agent: thinking, reading, writing on the blocks it changes, idle', () => {
    const states: unknown[] = []
    const awareness = { setLocalStateField: (field: string, value: unknown) => states.push([field, value]) }
    const editor = createTextbitEditor({ plugins: PLUGINS, value: [paragraph('aaaaaaaa-1', 'One')] })
    const agent = createDocumentAgent(editor, {
      plugins: PLUGINS,
      presence: createAgentPresence(awareness, { name: 'Assistant', color: 'green' })
    })

    const run = agent.startRun()
    agent.read()
    agent.read()
    agent.edit({ operations: [{ op: 'replaceText', id: 'aaaaaa', find: 'One', replace: 'Uno' }] })
    run.finish()

    expect(states).toEqual([
      [AGENT_PRESENCE_FIELD, { name: 'Assistant', color: 'green', status: 'thinking', blocks: [] }],
      [AGENT_PRESENCE_FIELD, { name: 'Assistant', color: 'green', status: 'reading', blocks: [] }],
      [AGENT_PRESENCE_FIELD, { name: 'Assistant', color: 'green', status: 'writing', blocks: ['aaaaaaaa-1'] }],
      [AGENT_PRESENCE_FIELD, { name: 'Assistant', color: 'green', status: 'idle', blocks: [] }]
    ])
  })
})
