// More than one node: one store, documents held by lease, frames passed on
// to the node holding a document, and taken over when it goes away
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import type { AddressInfo } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { createClient, type Client, type DocumentHandle } from '@dotvoid/y-quorum-client'
import {
  PROTOCOL_VERSION, ToClient, ToServer, encodeFrame, type Principal
} from '@dotvoid/y-quorum-client/protocol'
import { defineType, object, text } from '@dotvoid/y-quorum-client/model'
import { createServer, memory, StaleLease, type Node, type QuorumServer, type ServerType, type Storage } from '../lib'
import { nodeToken } from '../lib/cluster'
import { RawClient } from './_raw'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })
const article: ServerType = defineType('example/article', { content: object({ body: text() }), history: true })
const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' }
}

const servers: QuorumServer[] = []
const clients: Client[] = []

async function node(id: string, storage: Storage): Promise<{ server: QuorumServer, url: string }> {
  // The address is known once it listens; the server reads it when it takes a lease
  const self: Node = { id, address: '' }
  const server = createServer({
    types: [article],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    node: self,
    nodeSecret: 'shared between the nodes',
    leaseTtl: 300,
    idle: 50
  })
  const http = await server.listen(0)
  self.address = `ws://localhost:${(http.address() as AddressInfo).port}`
  servers.push(server)
  return { server, url: self.address }
}

function client(url: string, token: string) {
  const made = createClient({ url, token, grace: 20 })
  clients.push(made)
  return made
}

const paragraphOf = (handle: DocumentHandle) => (handle.content.getAttr('body') as Y.Node).get(0) as Y.Node
const textOf = (handle: DocumentHandle) => paragraphOf(handle).toDelta().children
  .map((op) => (typeof (op as { insert?: unknown }).insert === 'string' ? (op as { insert: string }).insert : '')).join('')
const until = async (check: () => boolean | Promise<boolean>, timeout = 4000) => {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close())
  for (const server of servers.splice(0)) {
    // A server whose store stopped answering never finishes closing
    await Promise.race([server.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 500))])
  }
})

describe('more than one node', () => {
  it('passes a document’s frames to the node holding it, both ways', async () => {
    const storage = memory()
    const a = await node('a', storage)
    const b = await node('b', storage)
    await a.server.create('news', 'c-1', 'example/article', { body: [paragraph('p', 'Calm.')] })

    const alice = await client(a.url, 'alice').open('news', 'c-1')
    const bob = await client(b.url, 'bob').open('news', 'c-1')
    expect((await storage.lease!('news', 'c-1', { id: 'b', address: b.url }, 300)).holder).toBe('a')

    paragraphOf(bob).insert(0, 'Bob. ')
    await until(() => textOf(alice) === 'Bob. Calm.')
    paragraphOf(alice).insert(0, 'Alice. ')
    await until(() => textOf(bob) === 'Alice. Bob. Calm.')
    await until(() => !bob.hasUnsavedChanges && !alice.hasUnsavedChanges)
    expect((await storage.log('news', 'c-1')).map((entry) => entry.actor.principal.id)).toEqual(['bob', 'alice'])
  })

  it('moves a document to another node when its node shuts down, nothing lost', async () => {
    const storage = memory()
    const a = await node('a', storage)
    const b = await node('b', storage)
    await a.server.create('news', 'c-2', 'example/article', { body: [paragraph('p', 'Calm.')] })
    await client(a.url, 'alice').open('news', 'c-2')
    const bob = await client(b.url, 'bob').open('news', 'c-2')

    await a.server.close()
    // Written while the document moves
    paragraphOf(bob).insert(0, 'Moved. ')
    await until(async () => String(JSON.stringify(await b.server.read('news', 'c-2').catch(() => undefined))).includes('Moved. Calm.'))
    expect((await storage.lease!('news', 'c-2', { id: 'x', address: '' }, 300)).holder).toBe('b')
  })

  it('takes over a document from a node that crashed, once its lease runs out', async () => {
    const storage = memory()
    // Node a on an HTTP server of the test's own, to cut it off as a crash does:
    // its connections dropped, its store no longer answering, nothing let go
    let crashed = false
    const failing = new Proxy(storage, {
      get: (target, key: keyof Storage) => {
        const value = target[key]
        return typeof value === 'function'
          ? (...args: unknown[]) => (crashed ? new Promise(() => undefined) : (value as (...a: unknown[]) => unknown).apply(target, args))
          : value
      }
    })
    const self: Node = { id: 'a', address: '' }
    const crashing = createServer({
      types: [article],
      storage: failing,
      authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
      node: self,
      nodeSecret: 'shared between the nodes',
      leaseTtl: 300
    })
    const http = createHttpServer()
    const sockets = new Set<Duplex>()
    http.on('upgrade', (_request, socket: Duplex) => sockets.add(socket))
    crashing.attach(http)
    await new Promise<void>((resolve) => http.listen(0, resolve))
    self.address = `ws://localhost:${(http.address() as AddressInfo).port}`

    const b = await node('b', storage)
    await crashing.create('news', 'c-3', 'example/article', { body: [paragraph('p', 'Calm.')] })
    await client(self.address, 'alice').open('news', 'c-3')
    const bob = await client(b.url, 'bob').open('news', 'c-3')

    crashed = true
    http.close()
    sockets.forEach((socket) => socket.destroy())
    paragraphOf(bob).insert(0, 'Taken over. ')
    await until(async () => String(JSON.stringify(await b.server.read('news', 'c-3').catch(() => undefined))).includes('Taken over. Calm.'), 6000)
    const lease = await storage.lease!('news', 'c-3', { id: 'x', address: '' }, 300)
    expect(lease).toMatchObject({ holder: 'b' })
    expect(lease.epoch).toBeGreaterThan(1)
  }, 10000)

  it('refuses a write from a node whose lease passed to another', async () => {
    const storage = memory()
    await storage.create('news', 'c-4', { type: 'example/article', incarnation: 'i', createdAt: 0 }, { states: {} })
    const first = await storage.lease!('news', 'c-4', { id: 'a', address: 'a' }, 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await storage.lease!('news', 'c-4', { id: 'b', address: 'b' }, 1000)
    const entry = { seq: 1, at: 0, layer: 'content' as const, actor: { principal: people.alice }, update: new Uint8Array() }
    await expect(storage.append('news', 'c-4', [entry], first.epoch)).rejects.toBeInstanceOf(StaleLease)
  })

  it('closes a document deleted on another node, and its node writes nothing more', async () => {
    const storage = memory()
    const a = await node('a', storage)
    const b = await node('b', storage)
    await a.server.create('news', 'c-5', 'example/article', { body: [paragraph('p', 'Calm.')] })
    const raw = await RawClient.connect(Number(new URL(a.url).port))
    await raw.hello('alice')
    const { doc } = await raw.open(1, 'news', 'c-5')
    const held = await storage.leaseOf!('news', 'c-5')
    expect(held?.holder).toBe('a')

    await b.server.delete('news', 'c-5')
    expect((await raw.next(ToClient.CLOSED, (h) => h.ref === 1)).header.code).toBe('gone')
    expect(await storage.load('news', 'c-5')).toBeUndefined()
    // The old lease no longer writes: a deleted document stays deleted
    const entry = {
      seq: 1, at: 0, layer: 'content' as const, actor: { principal: people.alice },
      update: Y.encodeStateAsUpdate(doc)
    }
    await expect(storage.append('news', 'c-5', [entry], held!.epoch))
      .rejects.toBeInstanceOf(StaleLease)
    raw.close()
  })

  it('passes a host’s message to the node holding the document', async () => {
    const storage = memory()
    const a = await node('a', storage)
    const b = await node('b', storage)
    await a.server.create('news', 'c-6', 'example/article', { body: [paragraph('p', 'Calm.')] })
    const raw = await RawClient.connect(Number(new URL(a.url).port))
    await raw.hello('alice')
    await raw.open(1, 'news', 'c-6')

    b.server.send('news', 'c-6', { hello: 'from b' })
    expect((await raw.next(ToClient.MESSAGE)).header)
      .toMatchObject({ ref: 1, message: { hello: 'from b' } })
    // Nobody but another node sends that frame
    raw.send(ToServer.NODE_MESSAGE, { namespace: 'news', id: 'c-6', message: 'forged' })
    await expect(raw.next(ToClient.MESSAGE, () => true, 200)).rejects.toThrow()
    raw.close()
  })

  it('refuses someone pretending to be a node', async () => {
    const storage = memory()
    const a = await node('a', storage)
    const raw = await RawClient.connect(Number(new URL(a.url).port))
    const forged = `y-quorum-node ${Buffer.from(JSON.stringify({ principal: people.alice, namespaces: '*' })).toString('base64url')}.not-the-mac`
    raw.send(ToServer.HELLO, { protocol: PROTOCOL_VERSION, token: forged })
    expect((await raw.next(ToClient.REFUSED)).header.code).toBe('unauthenticated')
    raw.close()
  })

  it('passes no NODE_MESSAGE of a client on through its relay', async () => {
    const storage = memory()
    const a = await node('a', storage)
    const b = await node('b', storage)
    await a.server.create('news', 'c-7', 'example/article', { body: [paragraph('p', 'Calm.')] })
    await a.server.create('news', 'c-8', 'example/article', { body: [paragraph('p', 'Other.')] })
    const alice = await RawClient.connect(Number(new URL(a.url).port))
    await alice.hello('alice')
    await alice.open(1, 'news', 'c-8')
    await alice.open(2, 'news', 'c-7')
    // Bob reaches c-7 on b, which passes it on to a; then tries to speak as b
    const bob = await RawClient.connect(Number(new URL(b.url).port))
    await bob.hello('bob')
    await bob.open(7, 'news', 'c-7')
    bob.socket.send(encodeFrame(ToServer.NODE_MESSAGE,
      { ref: 7, namespace: 'news', id: 'c-8', message: 'forged' } as never))
    await expect(alice.next(ToClient.MESSAGE, () => true, 300)).rejects.toThrow()
    alice.close()
    bob.close()
  })

  it('refuses a node’s token once it is old', async () => {
    const storage = memory()
    const a = await node('a', storage)
    const raw = await RawClient.connect(Number(new URL(a.url).port))
    const realNow = Date.now
    Date.now = () => realNow() - 10 * 60_000
    const old = nodeToken('shared between the nodes', { principal: people.alice, namespaces: '*' })
    Date.now = realNow
    raw.send(ToServer.HELLO, { protocol: PROTOCOL_VERSION, token: old })
    expect((await raw.next(ToClient.REFUSED)).header.code).toBe('unauthenticated')
    raw.close()
  })
})
