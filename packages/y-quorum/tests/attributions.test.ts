// Who wrote what, as the server decides it and every client sees it
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Text, Transforms, type Descendant, type Element } from 'slate'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type DocumentHandle } from '@dotvoid/y-quorum-client'
import { defineType, object, text } from '@dotvoid/y-quorum-client/model'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { createServer, memory, sqlite, type QuorumServer, type ServerType, type Storage } from '../lib'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })

const article: ServerType = defineType('example/article', { content: object({ body: text() }), history: true })
const note: ServerType = defineType('example/note', { content: object({ body: text() }) })

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' }
}

const servers: QuorumServer[] = []
const clients: Client[] = []
let url: string

async function start(storage: Storage = memory()) {
  const server = createServer({
    types: [article, note],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    idle: 50
  })
  servers.push(server)
  const http = await server.listen(0)
  url = `ws://localhost:${(http.address() as AddressInfo).port}`
  return server
}

async function open(token: string, id: string) {
  const client = createClient({ url, token, grace: 20 })
  clients.push(client)
  return client.open('news', id)
}

const body = (handle: DocumentHandle) => handle.content.getAttr('body') as Y.Node
const saved = (handle: DocumentHandle) => until(() => !handle.hasUnsavedChanges)
const until = async (check: () => boolean, timeout = 2000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

// The text of a paragraph, piece by piece, with who wrote each
const byWho = (children: Descendant[]) => ((children[0] as Element).children as Descendant[])
  .filter(Text.isText)
  .map((leaf) => [leaf.text, (leaf as { _by?: string })._by])

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  for (const server of servers.splice(0)) {
    await server.close()
  }
})

describe('attributions', () => {
  it('say who wrote what, in every editor showing them, an agent as itself for its person', async () => {
    const server = await start()
    await server.create('news', 'a-1', 'example/article', { body: [paragraph('p', 'The harbour.')] }, { principal: people.alice })
    const alice = await open('alice', 'a-1')
    const bob = await open('bob', 'a-1')
    const aliceEditor = createTextbitEditor({ shared: body(alice) })
    const bobView = createTextbitEditor({ shared: body(bob), renderer: bob.attributionsRenderer() })

    // Bob's agent adds a word through Bob's own connection
    const agent = bob.claimOrigin({ agent: 'copy', name: 'Copy editor', run: 'r1' })
    bob.doc.transact(() => (body(bob).get(0) as Y.Node).insert(4, 'old '), agent)
    await saved(bob)
    Transforms.insertText(aliceEditor, '!', { at: { path: [0, 0], offset: 'The old harbour.'.length } })
    await saved(alice)

    await until(() => byWho(bobView.children).length === 4)
    expect(byWho(bobView.children)).toEqual([
      ['The ', 'person:alice'],
      ['old ', 'agent:copy'],
      ['harbour.', 'person:alice'],
      ['!', 'person:alice']
    ])
    expect(bob.people).toMatchObject({
      'person:alice': { name: 'Alice' },
      'agent:copy': { kind: 'agent', name: 'Copy editor' },
      'person:bob': { name: 'Bob' }
    })
    // The agent's text says whom it wrote for, and in which run
    const old = (body(bob).get(0) as Y.Node).toDelta({ renderer: bob.attributionsRenderer() }).children
      .map((op) => (op as { attribution?: Record<string, unknown> }).attribution)
      .find((attribution) => (attribution?.insert as string[] | undefined)?.[0] === 'agent:copy')
    expect(old).toMatchObject({ 'insert:onBehalfOf': 'person:bob', 'insert:run': 'r1' })
  })

  it('come back after a restart, from the checkpoint and from the log after it', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-attributions-'))
    try {
      // A store that stops writing, as a process does when it crashes
      let crashed = false
      const store = sqlite(join(folder, 'db.sqlite'))
      const crashable = new Proxy(store, {
        get: (target, key: keyof Storage) => {
          const value = target[key]
          const reads = ['load', 'log', 'history', 'version', 'versions']
          return typeof value === 'function' && !reads.includes(key)
            ? (...args: unknown[]) => (crashed ? Promise.resolve() : (value as (...a: unknown[]) => unknown).apply(target, args))
            : value
        }
      })
      const first = await start(crashable)
      await first.create('news', 'a-2', 'example/article', { body: [paragraph('p', 'The harbour.')] })
      const bob = await open('bob', 'a-2')
      ;(body(bob).get(0) as Y.Node).insert(0, 'Cold. ')
      await saved(bob)

      // The first server crashes; a second starts on the same file: nothing
      // was checkpointed since the document was made, so Bob's change comes from the log
      crashed = true
      await start(sqlite(join(folder, 'db.sqlite')))
      const alice = await open('alice', 'a-2')
      const view = createTextbitEditor({ shared: body(alice), renderer: alice.attributionsRenderer() })

      expect(byWho(view.children)).toEqual([['Cold. ', 'person:bob'], ['The harbour.', 'service:system']])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('a type without history keeps none', async () => {
    const server = await start()
    await server.create('news', 'n-1', 'example/note', { body: [paragraph('p', 'Hello')] })
    const alice = await open('alice', 'n-1')
    const seen: unknown[] = []
    alice.on('attributions', (change) => seen.push(change))
    ;(body(alice).get(0) as Y.Node).insert(0, 'Oh. ')
    await saved(alice)

    expect(seen).toEqual([])
    expect(Y.createIdSetFromIdMap(alice.attributions().inserts).isEmpty()).toBe(true)
  })
})
