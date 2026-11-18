import { describe, test, expect } from 'vitest'
import { Editor, type Descendant } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, relativePositionToSlatePoint, slateNodesToInsertDelta } from '@slate-yjs/core'
import { createTextbitEditor, AGENT_PRESENCE_FIELD, type TBAgentChange as AgentChange, type TBAgentPresence as AgentPresenceState } from '@dotvoid/textbit/headless'
import { Text, Bold } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent, createAgentPresence } from '../lib'

const PLUGINS = [Text(), Bold()]

function setup() {
  const base = new Y.Doc()
  base.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta([
    { id: '11111111-a', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Spelling: teh mistake and ' }, { text: 'alot', 'base/bold': true }, { text: ' more.' }] },
    { id: '22222222-b', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Untouched' }] }
  ] as Descendant[]))
  const agentDoc = new Y.Doc()
  const personDoc = new Y.Doc()
  Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(base))
  Y.applyUpdate(personDoc, Y.encodeStateAsUpdate(base))

  const connect = (doc: Y.Doc) => {
    const editor = createTextbitEditor({ plugins: PLUGINS, shared: doc.get('content', Y.XmlText) })
    YjsEditor.connect(editor as YjsEditor & Editor)
    return editor as YjsEditor & Editor
  }
  const server = connect(agentDoc)
  const person = connect(personDoc)

  let state: AgentPresenceState | null = null
  const presence = createAgentPresence({ setLocalStateField: (field, value) => {
    if (field === AGENT_PRESENCE_FIELD) {
      state = value as AgentPresenceState | null
    }
  } }, { name: 'Assistant' })
  const agent = createDocumentAgent(server, { plugins: PLUGINS, presence })
  const sync = () => {
    Y.applyUpdate(personDoc, Y.encodeStateAsUpdate(agentDoc, Y.encodeStateVector(personDoc)))
    Y.applyUpdate(agentDoc, Y.encodeStateAsUpdate(personDoc, Y.encodeStateVector(agentDoc)))
  }
  return { agent, person, sync, state: () => state as AgentPresenceState | null }
}

/** Where a change is in a peer's copy */
function textAt(editor: YjsEditor & Editor, change: AgentChange): string {
  const point = (bytes: number[]) => relativePositionToSlatePoint(editor.sharedRoot, editor, Y.decodeRelativePosition(Uint8Array.from(bytes)))!
  return Editor.string(editor, { anchor: point(change.from), focus: point(change.to) })
}

describe('what an agent changed, shown to others', () => {
  test('each change in the text, by words, placed where the others see it', () => {
    const { agent, person, sync, state } = setup()
    agent.startRun()
    agent.edit({ operations: [
      { op: 'replaceText', id: '11111111', find: 'teh', replace: 'the' },
      { op: 'replaceText', id: '11111111', find: 'alot', replace: 'a lot' }
    ] })
    sync()

    const changes = state()?.changes ?? []
    expect(changes.map(({ block, added, removed }) => ({ block, added, removed }))).toEqual([
      { block: '11111111-a', added: 'the', removed: 'teh' },
      { block: '11111111-a', added: 'a lot', removed: 'alot' }
    ])
    expect(changes.map((change) => textAt(person, change))).toEqual(['the', 'a lot'])
  })

  test('a removal is placed where the text was; new blocks are all new', () => {
    const { agent, person, sync, state } = setup()
    agent.edit({ operations: [
      { op: 'replaceText', id: '11111111', find: 'Spelling: ', replace: '' },
      { op: 'insert', after: '22222222', content: '[text] Brand new' }
    ] })
    sync()
    const [removal, addition] = state()?.changes ?? []
    expect(removal).toMatchObject({ removed: 'Spelling: ' })
    expect(removal.added).toBeUndefined()
    expect(textAt(person, removal)).toBe('')
    expect(addition).toMatchObject({ added: 'Brand new' })
    expect(textAt(person, addition)).toBe('Brand new')
  })

  test('a new run starts without them, and an undo takes them away', () => {
    const { agent, state } = setup()
    const first = agent.startRun()
    agent.edit({ operations: [{ op: 'replaceText', id: '11111111', find: 'teh', replace: 'the' }] })
    first.finish()
    expect(state()?.changes).toHaveLength(1)

    const second = agent.startRun()
    expect(state()?.changes).toBeUndefined()
    agent.edit({ operations: [{ op: 'replaceText', id: '22222222', find: 'Untouched', replace: 'Touched' }] })
    expect(state()?.changes).toHaveLength(1)
    second.undo()
    expect(state()?.changes).toBeUndefined()
  })
})
