// The real client against the real server, with textbit editors bound to
// text fields: what a host's page and an agent's process do
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Node, Transforms } from 'slate'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createClient, type Client, type DocumentHandle, type Rejection } from '@dotvoid/y-quorum-client'
import { defineType, list, object, oneOf, string, text, id, toJSON, type Path } from '@dotvoid/y-quorum-client/model'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { createTextbitEditor, sharedOf } from '@dotvoid/textbit/headless'
import { createServer, memory, sqlite, type QuorumServer, type ServerType, type Storage } from '../lib'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })

const article: ServerType = {
  ...defineType('example/article', {
    content: object({
      title: text(),
      body: text(),
      status: oneOf(['draft', 'published']),
      slug: string({ optional: true }),
      links: list(object({ id: id(), label: text() }), { key: 'id' })
    }),
    records: { 'status.changed': {} }
  }),
  policy: ({ roles, content }) => {
    const write = content.getAttr('status') !== 'published' && roles.includes('editor')
    return { read: roles.length > 0, write, records: write ? ['status.changed'] : [] }
  }
}

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' },
  'agent:copy': { kind: 'agent', id: 'copy', name: 'Copy editor' }
}
const roles: Record<string, string[]> = { alice: ['editor'], bob: ['reader'], copy: ['editor'] }

let server: QuorumServer
let storage: Storage
let url: string
const clients: Client[] = []

async function start(store: Storage = memory(), port = 0) {
  storage = store
  server = createServer({
    types: [article],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => roles[principal.id] ?? null,
    idle: 50
  })
  const http = await server.listen(port)
  url = `ws://localhost:${(http.address() as AddressInfo).port}`
}

async function seed(id: string, words = 'The harbour in winter.') {
  await server.create('news', id, 'example/article', {
    title: [paragraph(`${id}-t`, 'Harbour')],
    body: [paragraph(`${id}-b`, words)],
    status: 'draft'
  })
}

function client(token: string) {
  const made = createClient({ url, token, grace: 20 })
  clients.push(made)
  return made
}

const field = (handle: DocumentHandle, name: string) => handle.content.getAttr(name) as Y.Node
const until = async (check: () => boolean, timeout = 2000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  await server?.close()
})

describe('people writing together', () => {
  it('an editor’s typing reaches another person’s editor', async () => {
    await start()
    await seed('a-1')
    const alice = await client('alice').open('news', 'a-1')
    const bob = await client('bob').open('news', 'a-1')
    const aliceEditor = createTextbitEditor({ shared: field(alice, 'body') })
    const bobEditor = createTextbitEditor({ shared: field(bob, 'body') })
    Transforms.insertText(aliceEditor, 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    await until(() => Node.string(bobEditor.children[0]) === 'Cold. The harbour in winter.')
    await until(() => !alice.hasUnsavedChanges)
    expect(sharedOf(bobEditor)!.check()).toBe(true)
  })

  it('a reader’s change is refused, handed back, and the reader rebuilt from the server', async () => {
    await start()
    await seed('a-2')
    const bob = await client('bob').open('news', 'a-2')
    const rejected = new Promise<Rejection>((resolve) => bob.on('rejected', resolve))
    const rebuilt = new Promise<void>((resolve) => bob.on('rebuilt', () => resolve()))
    const block = field(bob, 'body').get(0)
    if (block instanceof Y.Node) {
      block.insert(0, 'Mine. ')
    }
    const rejection = await rejected
    expect(rejection.code).toBe('not-allowed')
    expect(rejection.updates.length).toBeGreaterThan(0)
    await rebuilt
    expect(toJSON(bob.content, article.content)).toMatchObject({ body: [{ children: [{ text: 'The harbour in winter.' }] }] })
  })

  it('publishing makes the document read-only for everyone who has it open', async () => {
    await start()
    await seed('a-3')
    const alice = await client('alice').open('news', 'a-3')
    const other = await client('alice').open('news', 'a-3')
    const told = new Promise<boolean>((resolve) => other.on('capabilities', (c) => resolve(c.write)))
    alice.content.setAttr('status', 'published')
    expect(await told).toBe(false)
  })

  it('an agent working through the person’s editor is recorded as the agent, for the person', async () => {
    await start()
    await seed('a-4')
    const alice = await client('alice').open('news', 'a-4')
    const editor = createTextbitEditor({ shared: field(alice, 'body') })
    const origin = alice.claimOrigin({ agent: 'helper', name: 'Helper', run: 'run-1' })
    sharedOf(editor)!.withOrigin(origin, () => {
      Transforms.insertText(editor, 'Edited by the helper. ', { at: { path: [0, 0], offset: 0 } })
    })
    Transforms.insertText(editor, 'By Alice. ', { at: { path: [0, 0], offset: 0 } })
    await until(() => !alice.hasUnsavedChanges)
    const log = await storage.log('news', 'a-4')
    expect(log.map((entry) => entry.actor.principal.id)).toEqual(['helper', 'alice'])
    expect(log[0].actor.onBehalfOf).toEqual(people.alice)
  })

  it('an agent with a connection of its own writes as itself', async () => {
    await start()
    await seed('a-5')
    const agent = await client('agent:copy').open('news', 'a-5')
    agent.content.setAttr('slug', 'harbour')
    await until(() => !agent.hasUnsavedChanges)
    const log = await storage.log('news', 'a-5')
    expect(log[0].actor.principal).toEqual(people['agent:copy'])
  })
})

describe('many documents, many views, one connection', () => {
  it('opens a hundred documents over one connection, and watches a hundred more', async () => {
    await start()
    const ids = Array.from({ length: 200 }, (_, i) => `doc-${i}`)
    await Promise.all(ids.map((id) => seed(id, `Text ${id}`)))
    const alice = client('alice')
    const opened = await Promise.all(ids.slice(0, 100).map((id) => alice.open('news', id)))
    const watched = await Promise.all(ids.slice(100).map((id) => alice.watch('news', id, ['status', 'title'])))
    expect(opened.map((handle) => Node.string(createTextbitEditor({ shared: field(handle, 'body') }).children[0])).at(-1)).toBe('Text doc-99')
    expect(watched[0].value).toMatchObject({ status: 'draft' })
    // A change to a watched document reaches its watcher
    const writer = await client('alice').open('news', 'doc-150')
    const changed = new Promise<Record<string, unknown>>((resolve) => watched[50].on('change', resolve))
    writer.content.setAttr('status', 'published')
    expect((await changed).status).toBe('published')
  })

  it('shares one document between views: two editors on one field, each with its own undo', async () => {
    await start()
    await seed('v-1')
    const alice = client('alice')
    const list = await alice.open('news', 'v-1')
    const full = await alice.open('news', 'v-1')
    expect(full.doc).toBe(list.doc)
    const one = createTextbitEditor({ shared: field(list, 'body') })
    const two = createTextbitEditor({ shared: field(full, 'body') })
    Transforms.insertText(one, 'ONE ', { at: { path: [0, 0], offset: 0 } })
    Transforms.insertText(two, ' TWO', { at: { path: [0, 0], offset: Node.string(two.children[0]).length } })
    expect(Node.string(two.children[0])).toBe('ONE The harbour in winter. TWO')
    one.undo()
    expect(Node.string(two.children[0])).toBe('The harbour in winter. TWO')
    const bob = await client('bob').open('news', 'v-1')
    await until(() => toJSON(bob.content, article.content).body !== undefined && Node.string(createTextbitEditor({ shared: field(bob, 'body') }).children[0]) === 'The harbour in winter. TWO')
  })

  it('tells who has which document open, and doing what', async () => {
    await start()
    await seed('p-1')
    const bob = client('bob')
    await bob.ready
    const seen: string[] = []
    bob.presence('news', (entries) => seen.push(entries.map((e) => `${e.principal.id}:${e.id}:${e.mode}`).join(',')))
    const alice = await client('alice').open('news', 'p-1')
    alice.setMode('editing')
    await until(() => seen.includes('alice:p-1:editing'))
  })
})

describe('restarts', () => {
  it('a client keeps its edits through a server restart and delivers them when it is back', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-'))
    try {
      await start(sqlite(join(folder, 'db.sqlite')))
      await seed('r-1')
      const port = Number(new URL(url).port)
      const alice = await client('alice').open('news', 'r-1')
      const editor = createTextbitEditor({ shared: field(alice, 'body') })
      await server.close()
      // Written while the server is away
      Transforms.insertText(editor, 'Offline. ', { at: { path: [0, 0], offset: 0 } })
      await start(sqlite(join(folder, 'db.sqlite')), port)
      await until(() => !alice.hasUnsavedChanges, 15000)
      const json = await server.read('news', 'r-1')
      expect(json).toMatchObject({ body: [{ children: [{ text: 'Offline. The harbour in winter.' }] }] })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }, 20000)
})

// Paths are only used as types here
export type { Path }
