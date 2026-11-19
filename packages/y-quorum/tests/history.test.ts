// The history: writes folded per actor, chained, exported and verified
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type DocumentHandle } from '@dotvoid/y-quorum-client'
import { defineType, object, text } from '@dotvoid/y-quorum-client/model'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { createServer, memory, sqlite, verifyHistory, type QuorumServer, type ServerType, type Storage } from '../lib'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })
const article: ServerType = defineType('example/article', { content: object({ body: text() }), history: true })

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' }
}

const servers: QuorumServer[] = []
const clients: Client[] = []
let url: string

async function start(storage: Storage = memory()) {
  const server = createServer({
    types: [article],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: () => ['owner'],
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

const paragraphOf = (handle: DocumentHandle) => (handle.content.getAttr('body') as Y.Node).get(0) as Y.Node
const type = async (handle: DocumentHandle, words: string) => {
  paragraphOf(handle).insert(0, words)
  await until(() => !handle.hasUnsavedChanges)
}
const until = async (check: () => boolean, timeout = 2000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
const parsed = (exported: string) => exported.split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  for (const server of servers.splice(0)) {
    await server.close()
  }
})

describe('history', () => {
  it('folds writes of one actor into one entry, a new actor or a version starting another', async () => {
    const server = await start()
    await server.create('news', 'h-1', 'example/article', { body: [paragraph('p', 'Harbour.')] })
    const bob = await open('bob', 'h-1')
    const alice = await open('alice', 'h-1')

    await type(bob, 'a')
    await type(bob, 'b')
    await type(bob, 'c')
    await type(alice, 'd')
    // Bob's agent, through Bob's connection, is another actor
    bob.doc.transact(() => paragraphOf(bob).insert(0, 'e'), bob.claimOrigin({ agent: 'copy', run: 'r1' }))
    await until(() => !bob.hasUnsavedChanges)
    await type(bob, 'f')
    await bob.save('Cut')
    await type(bob, 'g')

    const entries = parsed(await server.exportHistory('news', 'h-1'))
    expect(entries.map((entry) => [(entry.actor as { principal: { id: string } }).principal.id, entry.from, entry.to])).toEqual([
      ['bob', 1, 3],
      ['alice', 4, 4],
      ['copy', 5, 5],
      ['bob', 6, 6],
      ['bob', 7, 7]
    ])
    expect(entries[2].actor).toMatchObject({ onBehalfOf: { id: 'bob' }, run: 'r1' })
    expect(verifyHistory(await server.exportHistory('news', 'h-1'))).toMatchObject({ ok: true, entries: 5 })
  })

  it('a restore is an entry of its own, saying what it restored', async () => {
    const server = await start()
    await server.create('news', 'h-2', 'example/article', { body: [paragraph('p', 'Harbour.')] })
    const alice = await open('alice', 'h-2')
    await alice.save('Plain')
    await type(alice, 'Cold. ')
    await alice.restore(alice.versions[0].id)

    const entries = parsed(await server.exportHistory('news', 'h-2'))
    const backup = alice.versions.find((version) => version.kind === 'before-restore')!
    expect(entries.at(-1)).toMatchObject({ kind: 'restore', refs: { restored: alice.versions[0].id, backup: backup.id } })
  })

  it('tells when the exported history was tampered with', async () => {
    const server = await start()
    await server.create('news', 'h-3', 'example/article', { body: [paragraph('p', 'Harbour.')] })
    const bob = await open('bob', 'h-3')
    const alice = await open('alice', 'h-3')
    await type(bob, 'Cold. ')
    await type(alice, 'Very. ')
    await type(bob, 'Quiet. ')
    const lines = (await server.exportHistory('news', 'h-3')).split('\n')
    expect(lines).toHaveLength(3)

    // Someone else's name on a change
    const renamed = [...lines]
    renamed[1] = renamed[1].replace('"alice"', '"bob"')
    expect(verifyHistory(renamed)).toMatchObject({ ok: false, seq: 2, reason: 'It was changed after it was stored' })
    // A change taken out
    expect(verifyHistory([lines[0], lines[2]])).toMatchObject({ ok: false, seq: 3, reason: 'Entry 2 is missing' })
    // Another change under the same name
    const swapped = [...lines]
    const entry = JSON.parse(swapped[0]) as Record<string, unknown>
    swapped[0] = JSON.stringify({ ...entry, payload: Buffer.from('other').toString('base64') })
    expect(verifyHistory(swapped)).toMatchObject({ ok: false, seq: 1, reason: 'Its change is not the one it was stored with' })
    // The payload may go, the chain still holds
    const withoutPayload = lines.map((line) => {
      const entry = JSON.parse(line) as Record<string, unknown>
      delete entry.payload
      return JSON.stringify(entry)
    })
    expect(verifyHistory(withoutPayload)).toMatchObject({ ok: true, entries: 3 })
  })

  it('goes on from where it was after a restart', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-history-'))
    try {
      const first = await start(sqlite(join(folder, 'db.sqlite')))
      await first.create('news', 'h-4', 'example/article', { body: [paragraph('p', 'Harbour.')] })
      const bob = await open('bob', 'h-4')
      await type(bob, 'Cold. ')
      clients.splice(0).forEach((client) => client.close())
      await first.close()
      servers.splice(0)

      const second = await start(sqlite(join(folder, 'db.sqlite')))
      const alice = await open('alice', 'h-4')
      await type(alice, 'Very. ')

      const exported = await second.exportHistory('news', 'h-4')
      expect(verifyHistory(exported)).toMatchObject({ ok: true, entries: 2 })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
