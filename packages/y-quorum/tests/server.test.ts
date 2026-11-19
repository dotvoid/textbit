import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import * as awarenessProtocol from '@y/protocols/awareness'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { ToClient, ToServer, type Principal } from '@dotvoid/y-quorum-client/protocol'
import { defineType, date, list, object, oneOf, string, text, id, toJSON, resolvePath } from '@dotvoid/y-quorum-client/model'
import { fieldToValue } from '@dotvoid/textbit/headless'
import { createServer, host, memory, sqlite, type QuorumServer, type ServerType, type Storage } from '../lib'
import { RawClient } from './_raw'

const paragraph = (id: string, words: string) => ({ id, type: 'core/text', class: 'text', children: [{ text: words }] })

const plan: ServerType = {
  ...defineType('example/plan', {
    content: object({
      title: text({ plugins: 'singleLine' }),
      status: oneOf(['draft', 'published']),
      due: date({ optional: true }),
      meta: object({ slug: string() }),
      assignments: list(object({ id: id(), title: text(), status: oneOf(['todo', 'done']) }), { key: 'id' })
    }),
    records: { 'status.changed': {} }
  }),
  // Published documents are read-only for everyone; a meta-editor may change only the meta fields
  policy: ({ roles, content, paths }) => {
    const published = content.getAttr('status') === 'published'
    const editor = roles.includes('editor')
    const metaEditor = roles.includes('meta-editor')
    const write = !published && (editor || (metaEditor && (paths ?? [['meta']]).every((path) => path[0] === 'meta')))
    return { read: roles.length > 0, write, records: editor ? ['status.changed'] : [] }
  }
}

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' },
  carol: { kind: 'person', id: 'carol', name: 'Carol' },
  ingest: { kind: 'service', id: 'ingest', name: 'Ingest' }
}
const roles: Record<string, string[]> = { alice: ['editor'], bob: ['reader'], carol: ['meta-editor'], ingest: ['editor'] }

let server: QuorumServer
let port: number
let storage: Storage
const clients: RawClient[] = []

async function start(store: Storage = memory(), limits?: { open?: number }) {
  storage = store
  server = createServer({
    types: [plan],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => roles[principal.id] ?? null,
    rpc: { echo: (args) => args },
    ...(limits ? { limits } : {}),
    idle: 50
  })
  const http = await server.listen(0)
  port = (http.address() as AddressInfo).port
  await server.create('news', 'plan-1', 'example/plan', {
    title: [paragraph('t', 'Harbour feature')],
    status: 'draft',
    meta: { slug: 'harbour' },
    assignments: [{ id: 'text', title: [paragraph('a', 'Article')], status: 'todo' }]
  })
}

async function enter(who: string) {
  const client = await RawClient.connect(port)
  clients.push(client)
  await client.hello(who)
  return client
}

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  await server?.close()
})

const titleOf = (doc: Y.Doc) => resolvePath(doc.get('content'), plan.content, ['title'])!.value as Y.Node
const textOf = (field: Y.Node) => fieldToValue(field).map((block) => block.children.map((leaf) => ('text' in leaf ? leaf.text : '')).join('')).join('\n')

function typeInto(field: Y.Node, words: string) {
  const block = field.get(0) as Y.Node
  block.insert(0, words)
}

describe('the handshake', () => {
  it('refuses an unknown token and an old protocol, closing for good', async () => {
    await start()
    const stranger = await RawClient.connect(port)
    clients.push(stranger)
    stranger.send(ToServer.HELLO, { protocol: 1, token: 'mallory' })
    expect((await stranger.next(ToClient.REFUSED)).header.code).toBe('unauthenticated')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(stranger.closed?.code).toBe(4401)

    const old = await RawClient.connect(port)
    clients.push(old)
    old.send(ToServer.HELLO, { protocol: 0, token: 'alice' })
    expect((await old.next(ToClient.REFUSED)).header.code).toBe('stale-protocol')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(old.closed?.code).toBe(4426)
  })

  it('keeps people to their namespaces', async () => {
    await start()
    const alice = await enter('alice')
    const { frame } = await alice.open(1, 'sports', 'plan-1')
    expect(frame.type).toBe(ToClient.CLOSED)
  })
})

describe('writes', () => {
  it('syncs, accepts an editor’s change, acknowledges it and passes it on', async () => {
    await start()
    const alice = await enter('alice')
    const bob = await enter('bob')
    const a = await alice.open(1, 'news', 'plan-1')
    const b = await bob.open(7, 'news', 'plan-1')
    expect(toJSON(b.doc.get('content'), plan.content)).toMatchObject({ status: 'draft', meta: { slug: 'harbour' } })

    alice.change(1, a.doc, 1, () => typeInto(titleOf(a.doc), 'Winter '))
    expect((await alice.next(ToClient.ACK)).header).toMatchObject({ ref: 1, seq: 1, log: 1 })
    const passed = await bob.next(ToClient.UPDATE, (h) => h.ref === 7)
    Y.applyUpdate(b.doc, passed.payload, 'server')
    expect(textOf(titleOf(b.doc))).toBe('Winter Harbour feature')
  })

  it('refuses a reader’s change, with the update, so the app can keep it', async () => {
    await start()
    const bob = await enter('bob')
    const b = await bob.open(1, 'news', 'plan-1')
    const sent = bob.change(1, b.doc, 1, () => typeInto(titleOf(b.doc), 'Mine '))
    const rejected = await bob.next(ToClient.REJECTED)
    expect(rejected.header.code).toBe('not-allowed')
    expect(rejected.payload).toEqual(sent)
    expect(await server.read('news', 'plan-1')).toMatchObject({ title: [{ children: [{ text: 'Harbour feature' }] }] })
  })

  it('decides per field: a meta-editor may change the slug, not the title', async () => {
    await start()
    const carol = await enter('carol')
    const c = await carol.open(1, 'news', 'plan-1')
    carol.change(1, c.doc, 1, () => (resolvePath(c.doc.get('content'), plan.content, ['meta'])!.value as Y.Node).setAttr('slug', 'winter'))
    expect((await carol.next(ToClient.ACK)).header.seq).toBe(1)
    carol.change(1, c.doc, 2, () => typeInto(titleOf(c.doc), 'No '))
    const rejected = await carol.next(ToClient.REJECTED)
    expect(rejected.header.reason).toContain('title')
  })

  it('asks the policy again when content changes: publishing makes it read-only for everyone', async () => {
    await start()
    const alice = await enter('alice')
    const carol = await enter('carol')
    const a = await alice.open(1, 'news', 'plan-1')
    await carol.open(2, 'news', 'plan-1')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'published'))
    const policy = await carol.next(ToClient.POLICY)
    expect(policy.header).toMatchObject({ ref: 2, seq: 1, capabilities: { write: false } })
    expect((await alice.next(ToClient.POLICY)).header.capabilities.write).toBe(false)
  })

  it('writes under a client id only its principal has claimed', async () => {
    await start()
    const alice = await enter('alice')
    const doc = new Y.Doc()
    await alice.open(1, 'news', 'plan-1', doc)
    // Someone else opens with the same client id
    const ingest = await enter('ingest')
    const twin = new Y.Doc()
    twin.clientID = doc.clientID
    const { frame } = await ingest.open(1, 'news', 'plan-1', twin)
    expect(frame.type).toBe(ToClient.CLOSED)
    expect((frame.header as { code: string }).code).toBe('client-id-taken')
  })

  it('holds an update that arrives before what it depends on, until that arrives', async () => {
    await start()
    const alice = await enter('alice')
    const bob = await enter('bob')
    const a = await alice.open(1, 'news', 'plan-1')
    const b = await bob.open(1, 'news', 'plan-1')
    // Two changes, sent in the wrong order
    const start1 = Y.encodeStateVector(a.doc)
    a.doc.transact(() => typeInto(titleOf(a.doc), 'One '))
    const first = Y.encodeStateAsUpdate(a.doc, start1)
    const start2 = Y.encodeStateVector(a.doc)
    a.doc.transact(() => typeInto(titleOf(a.doc), 'Two '))
    const second = Y.encodeStateAsUpdate(a.doc, start2)
    alice.send(ToServer.UPDATE, { ref: 1, layer: 'content', seq: 2 }, second)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(alice.frames.some((frame) => frame.type === ToClient.REJECTED || frame.type === ToClient.ACK)).toBe(false)
    alice.send(ToServer.UPDATE, { ref: 1, layer: 'content', seq: 1 }, first)
    const acks = [await alice.next(ToClient.ACK), await alice.next(ToClient.ACK)].map((frame) => frame.header.seq)
    expect(acks.sort()).toEqual([1, 2])
    for (const update of [await bob.next(ToClient.UPDATE), await bob.next(ToClient.UPDATE)]) {
      Y.applyUpdate(b.doc, update.payload, 'server')
    }
    expect(textOf(titleOf(b.doc))).toBe('Two One Harbour feature')
    expect((await storage.log('news', 'plan-1')).map((entry) => entry.actor.principal.id)).toEqual(['alice', 'alice'])
  })

  it('refuses what waits too long for what it depends on, as a conflict', async () => {
    await start()
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'plan-1')
    // A change the server never gets
    a.doc.transact(() => typeInto(titleOf(a.doc), 'Lost '))
    // 65 changes that all depend on one the server never gets
    for (let seq = 2; seq <= 66; seq++) {
      const before = Y.encodeStateVector(a.doc)
      a.doc.transact(() => typeInto(titleOf(a.doc), 'x'))
      alice.send(ToServer.UPDATE, { ref: 1, layer: 'content', seq }, Y.encodeStateAsUpdate(a.doc, before))
    }
    const rejected = await alice.next(ToClient.REJECTED)
    expect(rejected.header.code).toBe('conflict')
  })

  it('records an agent’s change as the agent’s, on behalf of the person', async () => {
    await start()
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'plan-1')
    alice.change(1, a.doc, 1, () => typeInto(titleOf(a.doc), 'Agent '), { agent: 'copyeditor', name: 'Copy editor', run: 'r1', model: 'some-model' })
    await alice.next(ToClient.ACK)
    await server.close()
    const log = await storage.log('news', 'plan-1')
    expect(log[0].actor).toEqual({
      principal: { kind: 'agent', id: 'copyeditor', name: 'Copy editor' },
      onBehalfOf: people.alice,
      run: 'r1',
      model: 'some-model'
    })
  })

  it('lets code in this process write as a service, through the same rules', async () => {
    await start()
    const bob = await enter('bob')
    const b = await bob.open(1, 'news', 'plan-1')
    const accepted = await server.transact('news', 'plan-1', { principal: people.ingest }, (content) => {
      content.setAttr('due', '2026-12-24')
    })
    expect(accepted).toBe(true)
    const update = await bob.next(ToClient.UPDATE)
    Y.applyUpdate(b.doc, update.payload)
    expect(b.doc.get('content').getAttr('due')).toBe('2026-12-24')
    const refused = await server.transact('news', 'plan-1', { principal: people.bob }, (content) => content.setAttr('due', 'never'))
    expect(refused).toBe(false)
  })
})

describe('presence, records, watching and saving', () => {
  it('stamps awareness with who the server knows someone to be', async () => {
    await start()
    const alice = await enter('alice')
    const bob = await enter('bob')
    const a = await alice.open(1, 'news', 'plan-1')
    const b = await bob.open(1, 'news', 'plan-1')
    const awareness = new awarenessProtocol.Awareness(a.doc)
    awareness.setLocalState({ principal: { id: 'mallory', name: 'Not Alice' }, cursor: 1 })
    alice.send(ToServer.AWARENESS, { ref: 1 }, awarenessProtocol.encodeAwarenessUpdate(awareness, [a.doc.clientID]))
    const seen = new awarenessProtocol.Awareness(b.doc)
    awarenessProtocol.applyAwarenessUpdate(seen, (await bob.next(ToClient.AWARENESS)).payload, 'server')
    expect(seen.getStates().get(a.doc.clientID)).toMatchObject({ cursor: 1, principal: { id: 'alice', name: 'Alice' } })
  })

  it('appends records for those allowed, to everyone who has the document open', async () => {
    await start()
    const alice = await enter('alice')
    const bob = await enter('bob')
    await alice.open(1, 'news', 'plan-1')
    await bob.open(1, 'news', 'plan-1')
    alice.send(ToServer.RECORD, { ref: 1, seq: 1, kind: 'status.changed', data: { to: 'ready' } })
    const records = await bob.next(ToClient.RECORDS)
    expect(records.header.records[0]).toMatchObject({ seq: 1, kind: 'status.changed', actor: people.alice, data: { to: 'ready' } })
    bob.send(ToServer.RECORD, { ref: 1, seq: 1, kind: 'status.changed', data: {} })
    expect((await bob.next(ToClient.REJECTED)).header.code).toBe('not-allowed')
  })

  it('pushes watched fields as they change', async () => {
    await start()
    const alice = await enter('alice')
    const watcher = await enter('bob')
    watcher.send(ToServer.OPEN, { ref: 3, namespace: 'news', id: 'plan-1', mode: 'watch', paths: ['due', 'meta.slug'] })
    expect((await watcher.next(ToClient.OPENED)).header.projection).toEqual({ due: undefined, 'meta.slug': 'harbour' })
    const a = await alice.open(1, 'news', 'plan-1')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('due', '2026-12-01'))
    expect((await watcher.next(ToClient.PROJECTION)).header.projection).toEqual({ due: '2026-12-01', 'meta.slug': 'harbour' })
  })

  it('tells followers of a namespace who has which document open, and doing what', async () => {
    await start()
    const alice = await enter('alice')
    const bob = await enter('bob')
    bob.send(ToServer.PRESENCE, { namespace: 'news', follow: true })
    expect((await bob.next(ToClient.PRESENCE)).header.entries).toEqual([])
    await alice.open(1, 'news', 'plan-1')
    const reading = await bob.next(ToClient.PRESENCE, (h) => h.entries.length > 0)
    expect(reading.header.entries[0]).toMatchObject({ principal: people.alice, id: 'plan-1', mode: 'reading' })
    alice.send(ToServer.MODE, { ref: 1, mode: 'editing', visible: false })
    const editing = await bob.next(ToClient.PRESENCE, (h) => h.entries[0]?.mode === 'editing')
    expect(editing.header.entries[0].visible).toBe(false)
  })

  it('saves once the server holds everything the client had', async () => {
    let saved: Record<string, unknown> | undefined
    await start()
    await server.close()
    server = createServer({
      types: [plan],
      storage,
      authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
      authorize: ({ principal }) => roles[principal.id] ?? null,
      onSave: ({ json, label }) => {
        saved = { ...json, label }
      }
    })
    port = ((await server.listen(0)).address() as AddressInfo).port
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'plan-1')
    const serverVector = Buffer.from((a.frame.header as { stateVector: string }).stateVector, 'base64')
    // The save is asked for before the change arrives: it waits for it
    a.doc.transact(() => a.doc.get('content').setAttr('due', '2026-12-31'))
    alice.send(ToServer.SAVE, { ref: 1, call: 1, label: 'Before the holidays' }, Y.encodeStateVector(a.doc))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(alice.frames.some((frame) => frame.type === ToClient.SAVED)).toBe(false)
    alice.send(ToServer.UPDATE, { ref: 1, layer: 'content', seq: 1 }, Y.encodeStateAsUpdate(a.doc, serverVector))
    expect((await alice.next(ToClient.SAVED)).header.call).toBe(1)
    expect(saved).toMatchObject({ due: '2026-12-31', label: 'Before the holidays' })
  })

  it('answers calls to the host’s functions', async () => {
    await start()
    const alice = await enter('alice')
    alice.send(ToServer.RPC, { call: 5, name: 'echo', args: { hello: 'world' } })
    expect((await alice.next(ToClient.RESULT)).header).toEqual({ call: 5, ok: true, value: { hello: 'world' } })
  })

  it('keeps to its limits, with a reason of its own', async () => {
    await start(memory(), { open: 1 })
    await server.create('news', 'plan-2', 'example/plan', {})
    const alice = await enter('alice')
    await alice.open(1, 'news', 'plan-1')
    const { frame } = await alice.open(2, 'news', 'plan-2')
    expect((frame.header as { code: string }).code).toBe('over-limit')
  })
})

describe('SQLite', () => {
  it('keeps documents, their log and records across a restart', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-'))
    try {
      await start(sqlite(join(folder, 'db.sqlite')))
      const alice = await enter('alice')
      const a = await alice.open(1, 'news', 'plan-1')
      const incarnation = (a.frame.header as { incarnation: string }).incarnation
      alice.change(1, a.doc, 1, () => typeInto(titleOf(a.doc), 'Kept '))
      await alice.next(ToClient.ACK)
      alice.send(ToServer.RECORD, { ref: 1, seq: 1, kind: 'status.changed', data: { to: 'ready' } })
      await alice.next(ToClient.RECORDS)
      alice.close()
      clients.length = 0
      await server.close()

      server = createServer({
        types: [plan],
        storage: sqlite(join(folder, 'db.sqlite')),
        authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null)
      })
      port = ((await server.listen(0)).address() as AddressInfo).port
      const again = await enter('alice')
      const reopened = await again.open(1, 'news', 'plan-1')
      expect((reopened.frame.header as { incarnation: string }).incarnation).toBe(incarnation)
      expect(textOf(titleOf(reopened.doc))).toBe('Kept Harbour feature')
      expect((reopened.frame.header as { records: unknown[] }).records).toHaveLength(1)
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})


describe('a host that keeps JSON', () => {
  it('seeds a document from the host’s JSON, and hands JSON back when it unloads', async () => {
    const kept = new Map<string, { type: string, content: Record<string, unknown> }>([
      ['news/plan-9', { type: 'example/plan', content: { title: [paragraph('h', 'From the host')], status: 'draft', meta: { slug: 'host' } } }]
    ])
    const stored: Array<Record<string, unknown>> = []
    await start(host({
      load: async (namespace, id) => kept.get(`${namespace}/${id}`),
      store: async (_namespace, _id, document) => {
        stored.push(document.content)
      }
    }))
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'plan-9')
    expect(textOf(titleOf(a.doc))).toBe('From the host')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('due', '2027-01-01'))
    await alice.next(ToClient.ACK)
    alice.send(ToServer.CLOSE, { ref: 1 })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(stored.at(-1)).toMatchObject({ due: '2027-01-01', meta: { slug: 'host' } })
  })
})

describe('deleting', () => {
  it('closes a namespace’s open documents and removes them from storage', async () => {
    await start()
    const alice = await enter('alice')
    await alice.open(1, 'news', 'plan-1')
    await server.delete('news')
    expect((await alice.next(ToClient.CLOSED)).header.code).toBe('gone')
    expect(await storage.load('news', 'plan-1')).toBeUndefined()
  })
})
