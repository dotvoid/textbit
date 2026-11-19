import { describe, test, expect } from 'vitest'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import * as Y from '@y/y'
import { createTextbitEditor, seedField, fieldToValue } from '@dotvoid/textbit/headless'
import { Text, Bold, Image } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent } from '../lib'
import { parseElements } from '../lib/format'
import { createContext } from '../lib/context'

const PLUGINS = [Text(), Bold(), Image()]

const paragraph = (id: string, text: string) =>
  ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant

function peer(doc: Y.Doc) {
  const editor = createTextbitEditor({ plugins: PLUGINS, shared: doc.get('content') })
  return editor
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('an agent in a shared document', () => {
  test('edits while a person types elsewhere, and both copies agree', () => {
    const base = new Y.Doc()
    seedField(base.get('content'), [
      paragraph('11111111-a', 'Written by a person'),
      paragraph('22222222-b', 'To be rewritten')
    ])
    const personDoc = new Y.Doc()
    const agentDoc = new Y.Doc()
    sync(base, personDoc)
    sync(base, agentDoc)

    const person = peer(personDoc)
    const server = peer(agentDoc)
    const agent = createDocumentAgent(server, { plugins: PLUGINS })
    const { revision } = agent.read()

    // The person types in the first paragraph while the agent works on the second
    Transforms.insertText(person, ', still typing', { at: Editor.end(person, [0]) })
    sync(personDoc, agentDoc)

    const result = agent.edit({ revision, operations: [
      { op: 'replace', id: '22222222', content: '[text] Rewritten, [carefully]{bold}' },
      { op: 'insert', content: '[image src="https://example.com/a.png"]\n  [caption] Added by the agent' }
    ] })
    expect(result.ok).toBe(true)
    sync(agentDoc, personDoc)

    const shared = (doc: Y.Doc) => fieldToValue(doc.get('content'))
    expect(shared(personDoc)).toEqual(shared(agentDoc))
    expect(person.children.map((n) => Node.string(n))).toEqual([
      'Written by a person, still typing',
      'Rewritten, carefully',
      'Added by the agent'
    ])
  })

  test('refuses when the person changed the element it was about to change', () => {
    const base = new Y.Doc()
    seedField(base.get('content'), [paragraph('33333333-c', 'Shared words')])
    const personDoc = new Y.Doc()
    const agentDoc = new Y.Doc()
    sync(base, personDoc)
    sync(base, agentDoc)
    const person = peer(personDoc)
    const agent = createDocumentAgent(peer(agentDoc), { plugins: PLUGINS })

    const { revision } = agent.read()
    Transforms.insertText(person, ' and more', { at: Editor.end(person, [0]) })
    sync(personDoc, agentDoc)

    const result = agent.edit({ revision, operations: [{ op: 'replaceText', id: '33333333', find: 'Shared', replace: 'Common' }] })
    expect(result).toMatchObject({ ok: false, error: { code: 'stale' } })
    expect(!result.ok && result.view).toBe('[#333333 text] Shared words and more')
  })
})

describe('the format', () => {
  test('what read shows parses back to the same elements', () => {
    const plugins = PLUGINS
    const value = [
      paragraph('a', ''),
      { id: 'b', type: 'base/text', class: 'text', properties: { role: 'heading-2' }, children: [
        { text: 'Odd [chars] \\ and\nbreaks ' },
        { text: 'bold', 'base/bold': true }
      ] },
      { id: 'c', type: 'base/image', class: 'block', properties: { src: 'https://x.y/"q".png', width: 640 }, children: [
        { id: 'd', type: 'base/image/content', class: 'void', children: [{ text: '' }] },
        { id: 'e', type: 'base/image/alt', class: 'text', children: [{ text: 'Alt' }] },
        { id: 'f', type: 'base/image/caption', class: 'text', children: [{ text: 'Cap' }] }
      ] }
    ] as Descendant[]
    const editor = createTextbitEditor({ plugins, value: structuredClone(value) })
    const view = createDocumentAgent(editor, { plugins }).read().view
    const context = createContext({ plugins })
    const parsed = parseElements(context.schema, context.names, view.replace(/#\S+ /g, ''))

    const strip = (nodes: Descendant[]): unknown => nodes.map((node) => 'text' in node
      ? node
      : { type: node.type, class: node.class, properties: node.properties ?? {}, children: strip(node.children) })
    expect(strip(parsed.map((p) => p.element))).toEqual(strip(value))
  })
})
