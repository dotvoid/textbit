// What people and agents may do, and code in the server process too: comment
// rights on a read-only document, saving, records from code, renewed tokens,
// and the server's own client ids
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import type { AddressInfo } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { ToClient, ToServer, type Principal } from '@dotvoid/y-quorum-client/protocol'
import { defineType, object, oneOf, text } from '@dotvoid/y-quorum-client/model'
import {
  createServer, host, memory, type PolicyContext, type QuorumServer, type ServerOptions,
  type ServerType, type Storage
} from '../lib'
import { RawClient } from './_raw'

const paragraph = (id: string, words: string) =>
  ({ id, type: 'core/text', class: 'text', children: [{ text: words }] })

// Policies a test looks into
const asked: PolicyContext[] = []

// Read-only once published; records only for an agent working for Alice
const memo: ServerType = {
  ...defineType('example/memo', {
    content: object({ title: text(), status: oneOf(['draft', 'published']) }),
    comments: true,
    records: { 'memo.checked': {} }
  }),
  policy: (context) => {
    asked.push(context)
    const { roles, content, actor } = context
    const write = content.getAttr('status') !== 'published' && roles.includes('editor')
    const checker = actor.principal.kind === 'agent' && actor.onBehalfOf?.id === 'alice'
    return { read: roles.length > 0, write, records: checker ? ['memo.checked'] : [] }
  }
}

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' },
  ingest: { kind: 'service', id: 'ingest', name: 'Ingest' }
}
const checker: Principal = { kind: 'agent', id: 'checker', name: 'Checker' }
let roles: Record<string, string[]> = {}

let server: QuorumServer
let port: number
let storage: Storage
const clients: RawClient[] = []

async function start(extra: Partial<ServerOptions> = {}) {
  roles = { alice: ['editor'], bob: ['reader'], ingest: ['editor'] }
  asked.length = 0
  storage = extra.storage ?? memory()
  server = createServer({
    types: [memo],
    storage,
    authenticate: (token) =>
      (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => roles[principal.id] ?? null,
    idle: 50,
    ...extra
  })
  port = ((await server.listen(0)).address() as AddressInfo).port
  await server.create('news', 'm-1', 'example/memo', {
    title: [paragraph('t', 'Harbour')],
    status: 'draft'
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

describe('rights', () => {
  it('takes commenting on all from editors when the document becomes read-only', async () => {
    await start()
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    expect((a.frame.header as { capabilities: { comments: string } }).capabilities.comments)
      .toBe('all')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'published'))
    const policy = await alice.next(ToClient.POLICY)
    expect(policy.header.capabilities).toMatchObject({ write: false, comments: 'none' })
  })

  it('lets a policy see whom an agent acts for', async () => {
    await start()
    const record = await server.appendRecord('news', 'm-1',
      { principal: checker, onBehalfOf: people.alice }, 'memo.checked', { ok: true })
    expect(record).toMatchObject({ kind: 'memo.checked', onBehalfOf: people.alice })
    expect(asked.some((context) => context.actor.onBehalfOf?.id === 'alice')).toBe(true)
  })

  it('checks records from code as a client’s: the policy and the record kinds', async () => {
    await start()
    // Bob's agent: the policy gives records to Alice's only
    await expect(server.appendRecord('news', 'm-1',
      { principal: checker, onBehalfOf: people.bob }, 'memo.checked', {})).rejects.toThrow()
    await expect(server.appendRecord('news', 'm-1',
      { principal: checker, onBehalfOf: people.alice }, 'memo.unknown', {})).rejects.toThrow()
    expect((await storage.load('news', 'm-1'))?.records).toEqual([])
  })

  it('lets only those who may write save a type without history', async () => {
    const saves: string[] = []
    await start({ onSave: ({ actor }) => void saves.push(actor.principal.id) })
    const bob = await enter('bob')
    const b = await bob.open(1, 'news', 'm-1')
    bob.send(ToServer.SAVE, { ref: 1, call: 1 }, Y.encodeStateVector(b.doc))
    expect((await bob.next(ToClient.RESULT)).header)
      .toMatchObject({ ok: false, code: 'not-allowed' })
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    alice.send(ToServer.SAVE, { ref: 1, call: 1 }, Y.encodeStateVector(a.doc))
    await alice.next(ToClient.SAVED)
    expect(saves).toEqual(['alice'])
  })

  it('asks for roles again when a token is renewed', async () => {
    await start()
    const alice = await enter('alice')
    await alice.open(1, 'news', 'm-1')
    roles.alice = ['reader']
    alice.send(ToServer.TOKEN, { token: 'alice' })
    expect((await alice.next(ToClient.POLICY)).header.capabilities.write).toBe(false)
    roles = { ...roles, alice: [] }
    alice.send(ToServer.TOKEN, { token: 'alice' })
    expect((await alice.next(ToClient.CLOSED)).header.code).toBe('not-allowed')
  })

  it('writes from code under one client id per actor, not one per change', async () => {
    await start()
    for (const status of ['draft', 'draft', 'draft']) {
      await server.transact('news', 'm-1', { principal: people.ingest },
        (content) => content.setAttr('status', status))
    }
    const log = await storage.log('news', 'm-1')
    const clientIds = new Set(log.flatMap((entry) =>
      [...Y.createContentIdsFromUpdate(entry.update).inserts.clients.keys()]))
    expect(log).toHaveLength(3)
    expect(clientIds.size).toBe(1)
  })
})

describe('serving', () => {
  it('gives a host the JSON a while after a change, not only when it unloads', async () => {
    const stored: Array<Record<string, unknown>> = []
    const kept = host({
      load: async () => undefined,
      store: async (_namespace, _id, document) => void stored.push(document.content)
    })
    await start({ storage: kept, settleAfter: 20 })
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'published'))
    await alice.next(ToClient.ACK)
    await expect.poll(() => stored.at(-1)).toMatchObject({ status: 'published' })
    // Still open: it was not unloaded
    expect(alice.closed).toBeUndefined()
  })

  it('takes only upgrades to its path when given one', async () => {
    await start()
    const http = createHttpServer()
    // Another listener answers upgrades elsewhere, a moment later: had the
    // server taken it too, it would have answered first
    http.on('upgrade', (request, socket) => {
      if (request.url === '/other') {
        setTimeout(() => socket.end('HTTP/1.1 418 Elsewhere\r\n\r\n'), 20)
      }
    })
    server.attach(http, { path: '/collab' })
    await new Promise<void>((resolve) => http.listen(0, resolve))
    const at = (http.address() as AddressInfo).port
    try {
      const raw = await RawClient.connect(at, '/collab')
      clients.push(raw)
      expect((await raw.hello('alice')).header.principal.id).toBe('alice')
      await expect(RawClient.connect(at, '/other')).rejects.toThrow(/418/)
    } finally {
      clients.splice(0).forEach((client) => client.close())
      http.closeAllConnections()
      await new Promise((resolve) => http.close(resolve))
    }
  })
})
