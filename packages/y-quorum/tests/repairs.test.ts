// What two people's valid changes at once break, repaired by the owner as a
// change of its own; and agents' and code's writes checked before they apply
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import type { AddressInfo } from 'node:net'
import { Node, Transforms, type Descendant, type Editor } from 'slate'
import { createTextbitEditor, fieldToValue, sharedOf } from '@dotvoid/textbit/headless'
import { OrderedList, Text, UnorderedList } from '@dotvoid/textbit-plugins/definitions'
import { ToClient, type Principal } from '@dotvoid/y-quorum-client/protocol'
import {
  addItem, defineType, id, itemsOf, list, object, oneOf, text, type ListField
} from '@dotvoid/y-quorum-client/model'
import {
  createServer, memory, REPAIRER, type QuorumServer, type ServerType, type Storage
} from '../lib'
import { RawClient } from './_raw'

const p = (id: string, words: string): Descendant =>
  ({ id, class: 'text', type: 'base/text', children: [{ text: words }] }) as Descendant

const plugins = { default: [Text(), UnorderedList(), OrderedList()] }

const plan: ServerType = defineType('example/plan', {
  content: object({
    body: text(),
    status: oneOf(['draft', 'ready']),
    tasks: list(object({ id: id(), title: text(), done: oneOf(['yes', 'no']) }), { key: 'id' })
  }),
  history: true
})

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' }
}
const importer = { principal: { kind: 'service' as const, id: 'importer', name: 'Importer' } }

let server: QuorumServer
let storage: Storage
let port: number
const clients: RawClient[] = []

async function start(body: Descendant[]) {
  storage = memory()
  server = createServer({
    types: [plan],
    storage,
    authenticate: (token) =>
      (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    plugins,
    repairAfter: 10
  })
  port = ((await server.listen(0)).address() as AddressInfo).port
  await server.create('news', 'p-1', 'example/plan', { body, status: 'draft', tasks: [] })
}

async function open(who: string) {
  const client = await RawClient.connect(port)
  clients.push(client)
  await client.hello(who)
  const { doc } = await client.open(1, 'news', 'p-1')
  return { client, doc }
}

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  await server?.close()
})

const bodyOf = (doc: Y.Doc) => doc.get('content').getAttr('body') as Y.Node
const ids = (field: Y.Node) => fieldToValue(field).map((block) => block.id)

// What one person does in an editor on their own copy, sent as one update,
// before they have what the other did
type Person = { client: RawClient, doc: Y.Doc }

function edit(person: Person, seq: number, change: (editor: Editor) => void) {
  person.client.change(1, person.doc, seq, () => {
    const editor = createTextbitEditor({ plugins: plugins.default, shared: bodyOf(person.doc) })
    change(editor)
    sharedOf(editor)?.release()
  })
}

/** Applies the next updates a person receives */
async function received(person: { client: RawClient, doc: Y.Doc }, count: number) {
  for (let k = 0; k < count; k++) {
    Y.applyUpdate(person.doc, (await person.client.next(ToClient.UPDATE)).payload)
  }
}

async function settled(doc: Y.Doc, client: RawClient, check: () => boolean) {
  const until = Date.now() + 3000
  while (!check()) {
    if (Date.now() > until) {
      throw new Error('Never settled')
    }
    const update = await client.next(ToClient.UPDATE, () => true, 3000)
    Y.applyUpdate(doc, update.payload)
  }
}

describe('repairs', () => {
  it('removes the copy two people make moving one block at once, as its own change', async () => {
    await start([p('a', 'One'), p('b', 'Two'), p('c', 'Three')])
    const alice = await open('alice')
    const bob = await open('bob')
    edit(alice, 1, (editor) => Transforms.moveNodes(editor, { at: [2], to: [0] }))
    edit(bob, 1, (editor) => Transforms.moveNodes(editor, { at: [2], to: [1] }))
    await expect.poll(async () => (await storage.log('news', 'p-1')).length).toBe(3)
    // Bob's move, then the repair, reach Alice
    await received(alice, 2)
    expect(ids(bodyOf(alice.doc))).toEqual(['c', 'a', 'b'])

    const log = await storage.log('news', 'p-1')
    expect(log.map((entry) => entry.actor.principal.id)).toEqual(['alice', 'bob', 'y-quorum'])
    expect(log[2].actor.principal).toEqual(REPAIRER)
    await server.exportHistory('news', 'p-1')
    const history = await storage.history('news', 'p-1')
    expect(history.find((entry) => entry.kind === 'repair')?.actor.by).toBe('service:y-quorum')
  })

  it('puts a list right that two people changed at once, by the plugin’s rules', async () => {
    await start([p('a', 'One'), {
      id: 'l', class: 'text', type: 'base/unordered-list', children: [
        {
          id: 'l1', class: 'text', type: 'base/unordered-list/list-item',
          children: [{ text: 'First' }]
        }
      ]
    } as Descendant])
    const alice = await open('alice')
    const bob = await open('bob')
    // Alice makes it a numbered list; Bob adds an item to the bullet list
    edit(alice, 1, (editor) => {
      Transforms.select(editor, { path: [1, 0, 0], offset: 0 })
      OrderedList().actions![0].handler({ editor } as never)
    })
    edit(bob, 1, (editor) => Transforms.insertNodes(editor, {
      id: 'l2', class: 'text', type: 'base/unordered-list/list-item', children: [{ text: 'Second' }]
    } as Descendant, { at: [1, 1] }))
    await settled(alice.doc, alice.client, () => {
      const [, listBlock] = fieldToValue(bodyOf(alice.doc))
      return listBlock?.type === 'base/ordered-list' && listBlock.children.length === 2 &&
        listBlock.children
          .every((item) => (item as { type: string }).type === 'base/ordered-list/list-item')
    })
    expect(Node.string(fieldToValue(bodyOf(alice.doc))[1])).toBe('FirstSecond')
  })

  it('removes the later of two list items with one key, and puts a wrong value back', async () => {
    await start([p('a', 'One')])
    const alice = await open('alice')
    const bob = await open('bob')
    const tasks = (doc: Y.Doc) => doc.get('content').getAttr('tasks') as Y.Node
    const field = plan.content.fields.tasks as ListField
    // Both add the task `check`, each with what they think of it; Bob also
    // sets a status the type does not have
    alice.client.change(1, alice.doc, 1, () => {
      addItem(tasks(alice.doc), field, { id: 'check', done: 'no' }, 'm')
    })
    bob.client.change(1, bob.doc, 1, () => {
      addItem(tasks(bob.doc), field, { id: 'check', done: 'yes' }, 'n')
      bob.doc.get('content').setAttr('status', 'lost')
    })
    await expect.poll(async () => (await storage.log('news', 'p-1')).length).toBe(3)
    await received(alice, 2)
    expect(itemsOf(tasks(alice.doc))).toHaveLength(1)
    expect(alice.doc.get('content').getAttr('status')).toBe('draft')
    expect(itemsOf(tasks(alice.doc))[0].getAttr('done')).toBe('no')
  })

  it('leaves a document that is right alone', async () => {
    await start([p('a', 'One')])
    const alice = await open('alice')
    edit(alice, 1, (editor) =>
      Transforms.insertText(editor, ' more', { at: { path: [0, 0], offset: 3 } }))
    await alice.client.next(ToClient.ACK)
    await new Promise((resolve) => setTimeout(resolve, 60))
    const log = await storage.log('news', 'p-1')
    expect(log.map((entry) => entry.actor.principal.id)).toEqual(['alice'])
  })
})

describe('a person deleting', () => {
  it('is not repaired: a repair carries only what it changes', async () => {
    await start([p('a', 'One')])
    const alice = await open('alice')
    edit(alice, 1, (editor) =>
      Transforms.delete(editor, { at: { path: [0, 0], offset: 2 }, distance: 1 }))
    await alice.client.next(ToClient.ACK)
    edit(alice, 2, (editor) =>
      Transforms.insertText(editor, 'x', { at: { path: [0, 0], offset: 0 } }))
    await alice.client.next(ToClient.ACK)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const log = await storage.log('news', 'p-1')
    expect(log.map((entry) => entry.actor.principal.id)).toEqual(['alice', 'alice'])
  })
})

describe('agents and code', () => {
  it('are refused a write that adds a problem, before it applies', async () => {
    await start([p('a', 'One')])
    const set = (status: string) => server.transact('news', 'p-1', importer,
      (content) => content.setAttr('status', status))
    expect(await set('lost')).toBe(false)
    expect(await set('ready')).toBe(true)
    expect((await server.read('news', 'p-1'))?.status).toBe('ready')
  })
})

