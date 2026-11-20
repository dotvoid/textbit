// The Postgres adapter against PGlite, Postgres in this process: the same
// round trips the memory and SQLite adapters make, leases and fencing, and a
// server writing through it and a second server reading it back
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { AddressInfo } from 'node:net'
import * as Y from '@y/y'
import { Node, Transforms } from 'slate'
import { createClient, type Client } from '@dotvoid/y-quorum-client'
import { defineType, object, text } from '@dotvoid/y-quorum-client/model'
import type { DocumentRecord, Principal, VersionInfo } from '@dotvoid/y-quorum-client/protocol'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import {
  createServer, postgres, StaleLease,
  type Actor, type HistoryEntry, type LogEntry, type QuorumServer, type ServerType, type Storage
} from '../lib'

const alice: Principal = { kind: 'person', id: 'alice', name: 'Alice' }
const actor: Actor = { principal: alice }
const meta = { type: 'example/article', incarnation: 'i-1', createdAt: 1_700_000_000_000 }
const bytes = (...values: number[]) => new Uint8Array(values)
const entry = (seq: number, layer: LogEntry['layer'] = 'content'): LogEntry =>
  ({ seq, at: 1_700_000_000_000 + seq, layer, actor, update: bytes(seq, 1, 2) })
const historyEntry = (seq: number, to: number, payload?: Uint8Array): HistoryEntry => ({
  doc: 'news/a', seq, from: to, to, layer: 'content', at: 1, until: 2, actor: { by: 'person:alice' }, kind: 'edit',
  ...(payload ? { payload } : {}),
  payloadHash: `p${seq}`, prevHash: `h${seq - 1}`, hash: `h${seq}`
})
const version = (id: string, seq: number): VersionInfo =>
  ({ id, seq, at: seq, by: { kind: 'person', id: 'alice', name: 'Alice' }, kind: 'saved' })
const node = (id: string) => ({ id, address: `ws://${id}:1234` })
const lease = (holder: string) => storage.lease!('news', 'a', node(holder), 60_000)

let pg: PGlite
let storage: Storage

beforeEach(() => {
  pg = new PGlite()
  storage = postgres(pg)
})

afterEach(async () => {
  await pg.close()
})

describe('postgres storage', () => {
  it('creates and loads a document, and refuses to create it twice', async () => {
    expect(await storage.load('news', 'a')).toBeUndefined()
    await storage.create('news', 'a', meta, {
      states: { content: bytes(1), comments: bytes(2) },
      attributions: { content: bytes(3) },
      people: { alice: { kind: 'person', id: 'alice', name: 'Alice' } },
      reviewed: bytes(4)
    })
    const loaded = await storage.load('news', 'a')
    expect(loaded).toEqual({
      meta,
      checkpoint: {
        seq: 0,
        states: { content: bytes(1), comments: bytes(2) },
        attributions: { content: bytes(3) },
        people: { alice: { kind: 'person', id: 'alice', name: 'Alice' } },
        reviewed: bytes(4)
      },
      entries: [],
      records: [],
      versions: []
    })
    await expect(storage.create('news', 'a', meta, { states: { content: bytes(9) } }))
      .rejects.toThrow()
    expect((await storage.load('news', 'a'))?.checkpoint?.states.content).toEqual(bytes(1))
  })

  it('appends to the log and reads it from a position', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    await storage.append('news', 'a', [entry(1), entry(2, 'comments')])
    await storage.append('news', 'a', [entry(3)])
    const all = [entry(1), entry(2, 'comments'), entry(3)]
    expect(await storage.log('news', 'a')).toEqual(all)
    expect(await storage.log('news', 'a', 2)).toEqual([entry(3)])
    expect((await storage.load('news', 'a'))?.entries).toEqual(all)
  })

  it('loads the latest checkpoint and only the log after it, the log kept whole', async () => {
    await storage.create('news', 'a', meta, {
      states: { content: bytes(1), comments: bytes(2) },
      attributions: { comments: bytes(5) }
    })
    await storage.append('news', 'a', [entry(1), entry(2), entry(3)])
    await storage.checkpoint('news', 'a', { states: { content: bytes(7) }, reviewed: bytes(8) }, 2)
    const loaded = await storage.load('news', 'a')
    // What the new checkpoint leaves out is gone, as in the memory adapter
    expect(loaded?.checkpoint).toEqual({ seq: 2, states: { content: bytes(7) }, reviewed: bytes(8) })
    expect(loaded?.entries).toEqual([entry(3)])
    expect(await storage.log('news', 'a')).toHaveLength(3)
  })

  it('keeps records, with and without whom they were for', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    const agent: Principal = { kind: 'agent', id: 'copy', name: 'Copy' }
    const records: DocumentRecord[] = [
      { seq: 1, kind: 'status.changed', at: 5, actor: alice, data: { to: 'done' } },
      { seq: 2, kind: 'note', at: 6, actor: agent, onBehalfOf: alice, data: 'plain' }
    ]
    for (const record of records) {
      await storage.appendRecord('news', 'a', record)
    }
    expect((await storage.load('news', 'a'))?.records).toEqual(records)
  })

  it('keeps versions in order, and their states', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    await storage.addVersion('news', 'a', version('v2', 4), bytes(4))
    await storage.addVersion('news', 'a', version('v1', 0), bytes(0))
    await storage.addVersion('news', 'a', version('v3', 4), bytes(5))
    const versions = (await storage.load('news', 'a'))?.versions
    expect(versions?.map(({ id }) => id)).toEqual(['v1', 'v2', 'v3'])
    expect(await storage.versionState('news', 'a', 'v3')).toEqual(bytes(5))
    expect(await storage.versionState('news', 'a', 'none')).toBeUndefined()
  })

  it('keeps the history, and its head with the last log position it folds', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    expect((await storage.load('news', 'a'))?.historyHead).toBeUndefined()
    const entries = [historyEntry(1, 3, bytes(9)), historyEntry(2, 7)]
    await storage.appendHistory('news', 'a', entries)
    expect(await storage.history('news', 'a')).toEqual(entries)
    expect(await storage.history('news', 'a', 1)).toEqual([historyEntry(2, 7)])
    expect((await storage.load('news', 'a'))?.historyHead).toEqual({ seq: 2, hash: 'h2', to: 7 })
  })

  it('claims client ids for one principal, and tells who holds one without claiming', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    expect(await storage.clientHolder?.('news', 'a', 42)).toBeUndefined()
    expect(await storage.claimClient('news', 'a', 42, 'alice')).toBe(true)
    expect(await storage.claimClient('news', 'a', 42, 'alice')).toBe(true)
    expect(await storage.claimClient('news', 'a', 42, 'bob')).toBe(false)
    expect(await storage.clientHolder?.('news', 'a', 42)).toBe('alice')
    expect(await storage.clientHolder?.('news', 'a', 43)).toBeUndefined()
  })

  it('leases a document to one node, keeps it for it, and hands it over when it runs out', async () => {
    const first = await storage.lease!('news', 'a', node('n1'), 60_000)
    expect(first).toMatchObject({ holder: 'n1', address: 'ws://n1:1234', epoch: 1 })
    expect(first.until).toBeGreaterThan(Date.now() + 50_000)

    const kept = await storage.lease!('news', 'a', node('n1'), 120_000)
    expect(kept).toMatchObject({ holder: 'n1', epoch: 1 })
    expect(kept.until).toBeGreaterThan(first.until)

    const refused = await storage.lease!('news', 'a', node('n2'), 60_000)
    expect(refused).toEqual(kept)

    await storage.lease!('news', 'a', node('n1'), 20)
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(await lease('n2'))
      .toMatchObject({ holder: 'n2', address: 'ws://n2:1234', epoch: 2 })
    expect(await lease('n1')).toMatchObject({ holder: 'n2', epoch: 2 })
  })

  it('lets a released lease be taken at once, with a higher epoch', async () => {
    await lease('n1')
    await storage.releaseLease!('news', 'a', 'n2')
    expect(await lease('n2')).toMatchObject({ holder: 'n1', epoch: 1 })
    await storage.releaseLease!('news', 'a', 'n1')
    expect(await lease('n2')).toMatchObject({ holder: 'n2', epoch: 2 })
  })

  it('refuses an append from a node whose lease has passed on, and writes nothing of it', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    const { epoch } = await storage.lease!('news', 'a', node('n1'), 60_000)
    await storage.append('news', 'a', [entry(1)], epoch)
    await storage.releaseLease!('news', 'a', 'n1')
    const taken = await storage.lease!('news', 'a', node('n2'), 60_000)
    await expect(storage.append('news', 'a', [entry(2), entry(3)], epoch))
      .rejects.toBeInstanceOf(StaleLease)
    await storage.append('news', 'a', [entry(2)], taken.epoch)
    expect(await storage.log('news', 'a')).toEqual([entry(1), entry(2)])
  })

  it('deletes a document, or a whole namespace, and nothing else', async () => {
    for (const [namespace, id] of [['news', 'a'], ['news', 'b'], ['sport', 'a']]) {
      const states = { content: bytes(1), comments: bytes(2) }
      await storage.create(namespace, id, meta, { states })
      await storage.append(namespace, id, [entry(1)])
      const record = { seq: 1, kind: 'k', at: 1, actor: alice, data: null }
      await storage.appendRecord(namespace, id, record)
      await storage.addVersion(namespace, id, version('v1', 1), bytes(1))
      await storage.appendHistory(namespace, id, [historyEntry(1, 1)])
      await storage.claimClient(namespace, id, 1, 'alice')
      await storage.lease!(namespace, id, node('n1'), 60_000)
    }
    await storage.delete('news', 'a')
    expect(await storage.load('news', 'a')).toBeUndefined()
    expect(await storage.log('news', 'a')).toEqual([])
    expect(await storage.clientHolder?.('news', 'a', 1)).toBeUndefined()
    expect(await storage.load('news', 'b')).toBeDefined()

    await storage.delete('news')
    expect(await storage.load('news', 'b')).toBeUndefined()
    expect(await storage.versionState('news', 'b', 'v1')).toBeUndefined()
    expect(await storage.history('news', 'b')).toEqual([])
    const kept = await storage.load('sport', 'a')
    expect(kept?.entries).toEqual([entry(1)])
    expect(kept?.records).toHaveLength(1)
    expect(kept?.versions).toHaveLength(1)
  })

  it('keeps its tables in the schema it is given', async () => {
    const other = postgres(pg, { schema: 'tenant one' })
    await other.create('news', 'a', meta, { states: { content: bytes(1) } })
    expect(await storage.load('news', 'a')).toBeUndefined()
    expect((await other.load('news', 'a'))?.meta).toEqual(meta)
  })
})

describe('a server on postgres', () => {
  const article: ServerType = defineType('example/article', {
    content: object({ title: text(), body: text() })
  })
  const paragraph = (id: string, words: string) =>
    ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })
  const servers: QuorumServer[] = []
  const clients: Client[] = []

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.close())
    for (const server of servers.splice(0)) {
      await server.close()
    }
  })

  async function start() {
    const server = createServer({
      types: [article],
      storage: postgres(pg),
      authenticate: (token) => (token === 'alice' ? { principal: alice, namespaces: ['news'] } : null),
      idle: 50
    })
    servers.push(server)
    const http = await server.listen(0)
    return { server, url: `ws://localhost:${(http.address() as AddressInfo).port}` }
  }

  it('keeps what a client wrote for a second server to read', async () => {
    const { server, url } = await start()
    await server.create('news', 'p-1', 'example/article', {
      title: [paragraph('t', 'Harbour')],
      body: [paragraph('b', 'The harbour in winter.')]
    })
    const client = createClient({ url, token: 'alice', grace: 20 })
    clients.push(client)
    const handle = await client.open('news', 'p-1')
    const editor = createTextbitEditor({ shared: handle.content.getAttr('body') as Y.Node })
    Transforms.insertText(editor, 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    expect(Node.string(editor.children[0])).toBe('Cold. The harbour in winter.')
    const started = Date.now()
    while (handle.hasUnsavedChanges && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(handle.hasUnsavedChanges).toBe(false)
    client.close()
    await server.close()
    servers.splice(servers.indexOf(server), 1)

    const { server: second } = await start()
    expect(await second.read('news', 'p-1')).toMatchObject({
      body: [{ children: [{ text: 'Cold. The harbour in winter.' }] }]
    })
  })
})
