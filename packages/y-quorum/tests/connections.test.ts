// What a connection may and may not do to the server: say who it is once,
// reuse a ref, leave while a document opens, and what the server keeps right
// when its store fails, a document is deleted or unloads as it is opened again
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import type { AddressInfo } from 'node:net'
import { PROTOCOL_VERSION, ToClient, ToServer, type Principal } from '@dotvoid/y-quorum-client/protocol'
import { defineType, object, oneOf, text } from '@dotvoid/y-quorum-client/model'
import {
  createServer, host, memory, type QuorumServer, type ServerOptions, type ServerType,
  type Storage
} from '../lib'
import { RawClient } from './_raw'

const paragraph = (id: string, words: string) =>
  ({ id, type: 'core/text', class: 'text', children: [{ text: words }] })

// Nobody but editors reads an embargoed memo; records are for people, not agents
const memo: ServerType = {
  ...defineType('example/memo', {
    content: object({ title: text(), status: oneOf(['draft', 'embargo']) }),
    records: { 'memo.checked': {} },
    history: true
  }),
  policy: ({ roles, content, actor }) => {
    const editor = roles.includes('editor')
    return {
      read: roles.length > 0 && (editor || content.getAttr('status') !== 'embargo'),
      write: editor,
      records: actor.principal.kind === 'person' ? ['memo.checked'] : []
    }
  }
}

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' }
}
const roles: Record<string, string[]> = { alice: ['editor'], bob: ['reader'] }
const claim = { agent: 'helper', name: 'Helper' }

let server: QuorumServer
let port: number
let storage: Storage
const clients: RawClient[] = []

async function start(extra: Partial<ServerOptions> = {}) {
  storage = extra.storage ?? memory()
  server = createServer({
    types: [memo],
    storage,
    // `alice-alone`: Alice, with no agents acting for her
    authenticate: (token) => token === 'alice-alone'
      ? { principal: people.alice, namespaces: ['news'], agents: false }
      : people[token] ? { principal: people[token], namespaces: ['news'] } : null,
    authorize: ({ principal }) => roles[principal.id] ?? null,
    idle: 20,
    ...extra
  })
  port = ((await server.listen(0)).address() as AddressInfo).port
  for (const id of ['m-1', 'm-2']) {
    await server.create('news', id, 'example/memo', {
      title: [paragraph('t', 'Harbour')],
      status: 'draft'
    })
  }
}

async function enter(who: string) {
  const client = await RawClient.connect(port)
  clients.push(client)
  await client.hello(who)
  return client
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The storage, telling which documents were unloaded
function unloads(store: Storage = memory()) {
  const unloaded: string[] = []
  return {
    unloaded,
    storage: {
      ...store,
      unloaded: async (_namespace: string, id: string) => void unloaded.push(id)
    } as Storage
  }
}

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  await server?.close()
})

describe('a connection', () => {
  it('says who it is once: a second HELLO is refused', async () => {
    await start()
    const alice = await enter('alice')
    alice.send(ToServer.HELLO, { protocol: PROTOCOL_VERSION, token: 'bob' })
    expect((await alice.next(ToClient.REFUSED)).header.code).toBe('unauthenticated')
  })

  it('closes what a ref named before when it is used again', async () => {
    const { storage: store, unloaded } = unloads()
    await start({ storage: store })
    const alice = await enter('alice')
    await alice.open(1, 'news', 'm-1')
    await alice.open(1, 'news', 'm-2')
    await expect.poll(() => unloaded).toContain('m-1')
  })

  it('leaves nothing open when it goes while a document is opened', async () => {
    const { storage: store, unloaded } = unloads()
    await start({
      storage: store,
      authorize: async ({ principal }) => {
        await wait(100)
        return roles[principal.id] ?? null
      }
    })
    const alice = await enter('alice')
    alice.send(ToServer.OPEN, { ref: 1, namespace: 'news', id: 'm-1', mode: 'open' },
      Y.encodeStateVector(new Y.Doc()))
    alice.close()
    await expect.poll(() => unloaded, { timeout: 2000 }).toContain('m-1')
  })

  it('stops reading when the content takes reading away', async () => {
    await start()
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    const bob = await enter('bob')
    await bob.open(1, 'news', 'm-1')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'embargo'))
    expect((await bob.next(ToClient.CLOSED)).header.code).toBe('not-allowed')
    bob.frames.length = 0
    alice.change(1, a.doc, 2, () => (a.doc.get('content').getAttr('title') as Y.Node).delete(0))
    await alice.next(ToClient.ACK, (header) => header.seq === 2)
    await expect(bob.next(ToClient.UPDATE, () => true, 100)).rejects.toThrow()
  })

  it('lets agents act no more once a renewed token says so', async () => {
    await start()
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    alice.send(ToServer.TOKEN, { token: 'alice-alone' })
    await wait(50)
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'embargo'), claim)
    expect((await alice.next(ToClient.REJECTED)).header.code).toBe('not-allowed')
  })
})

describe('records', () => {
  it('stores a record sent again once', async () => {
    await start()
    const alice = await enter('alice')
    await alice.open(1, 'news', 'm-1')
    for (const seq of [1, 2]) {
      alice.send(ToServer.RECORD, { ref: 1, seq, kind: 'memo.checked', data: {}, id: 'r-1' })
      await alice.next(ToClient.ACK, (header) => header.seq === seq)
    }
    expect((await storage.load('news', 'm-1'))?.records).toHaveLength(1)
  })

  it('are an agent’s by what the policy lets the agent do', async () => {
    await start()
    const alice = await enter('alice')
    await alice.open(1, 'news', 'm-1')
    alice.send(ToServer.RECORD, { ref: 1, seq: 1, kind: 'memo.checked', data: {}, claim })
    expect((await alice.next(ToClient.REJECTED)).header.code).toBe('not-allowed')
  })
})

describe('the server', () => {
  it('judges a write again that it failed to store', async () => {
    const store = memory()
    let failing = true
    await start({
      storage: {
        ...store,
        append: (...args: Parameters<Storage['append']>) => {
          if (failing) {
            failing = false
            return Promise.reject(new Error('The store is away'))
          }
          return store.append(...args)
        }
      }
    })
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    const update = alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'embargo'))
    await expect(alice.next(ToClient.ACK, () => true, 200)).rejects.toThrow()
    alice.send(ToServer.UPDATE, { ref: 1, layer: 'content', seq: 2 }, update)
    await alice.next(ToClient.ACK, (header) => header.seq === 2)
    expect(await storage.log('news', 'm-1')).toHaveLength(1)
    expect((await server.read('news', 'm-1'))?.status).toBe('embargo')
  })

  it('writes nothing more of a deleted document', async () => {
    const stored: string[] = []
    const kept = host({
      load: async () => undefined,
      store: async (_namespace, id) => void stored.push(id)
    })
    await start({ storage: kept, settleAfter: 30 })
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'embargo'))
    await alice.next(ToClient.ACK)
    await server.delete('news', 'm-1')
    stored.length = 0
    await wait(120)
    expect(stored).toEqual([])
  })

  it('loads a document opened again as it unloads once it is stored', async () => {
    const store = memory()
    await start({
      storage: {
        ...store,
        appendHistory: async (...args: Parameters<Storage['appendHistory']>) => {
          await wait(150)
          return store.appendHistory(...args)
        }
      }
    })
    const alice = await enter('alice')
    const a = await alice.open(1, 'news', 'm-1')
    alice.change(1, a.doc, 1, () => a.doc.get('content').setAttr('status', 'embargo'))
    await alice.next(ToClient.ACK)
    alice.close()
    // Idle, and unloading: opened again meanwhile
    await wait(60)
    const again = await enter('alice')
    const b = await again.open(1, 'news', 'm-1')
    again.change(1, b.doc, 1, () => b.doc.get('content').setAttr('status', 'draft'))
    await again.next(ToClient.ACK)
    await server.exportHistory('news', 'm-1')
    const seqs = (await storage.history('news', 'm-1')).map((entry) => entry.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
  })
})
