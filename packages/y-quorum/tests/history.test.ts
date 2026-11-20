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
const article: ServerType = defineType('example/article', { content: object({ body: text() }), history: true, records: { 'status.changed': {} } })

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' },
  'agent:copy': { kind: 'agent', id: 'copy', name: 'Copy editor' }
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
    expect(entries.map((entry) => [(entry.actor as { by: string }).by.split(':')[1], entry.from, entry.to])).toEqual([
      ['bob', 1, 3],
      ['alice', 4, 4],
      ['copy', 5, 5],
      ['bob', 6, 6],
      ['bob', 7, 7]
    ])
    expect(entries[2].actor).toMatchObject({ onBehalfOf: 'person:bob', run: 'r1' })
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
    renamed[1] = renamed[1].replace('person:alice', 'person:bob')
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

  it('keeps who reviewed what agents wrote, and tells what nobody has', async () => {
    const server = await start()
    await server.create('news', 'h-5', 'example/article', { body: [paragraph('p', 'Harbour.')] })
    const bob = await open('bob', 'h-5')
    const alice = await open('alice', 'h-5')
    const agentWrites = async (words: string, run: string) => {
      bob.doc.transact(() => paragraphOf(bob).insert(0, words), bob.claimOrigin({ agent: 'copy', run }))
      await until(() => !bob.hasUnsavedChanges)
    }
    await agentWrites('Cold. ', 'r1')
    await agentWrites('Very. ', 'r2')
    await type(bob, 'Mine. ')

    expect(await alice.unreviewed()).toEqual([
      { agent: 'agent:copy', onBehalfOf: 'person:bob', run: 'r1', length: 6 },
      { agent: 'agent:copy', onBehalfOf: 'person:bob', run: 'r2', length: 6 }
    ])
    expect(await alice.review('r1')).toEqual([{ agent: 'agent:copy', onBehalfOf: 'person:bob', run: 'r2', length: 6 }])
    expect(await alice.review()).toEqual([])

    // Written after the review: not covered by it
    await agentWrites('Grey. ', 'r3')
    expect(await server.unreviewed('news', 'h-5')).toEqual([{ agent: 'agent:copy', onBehalfOf: 'person:bob', run: 'r3', length: 6 }])
    // Deleted again: nothing left to review
    paragraphOf(bob).delete(0, 6)
    await until(() => !bob.hasUnsavedChanges)
    await until(() => alice.attributions().deletes.isEmpty() === false)
    expect(await alice.unreviewed()).toEqual([])

    const exported = await server.exportHistory('news', 'h-5')
    const reviews = parsed(exported).filter((entry) => entry.kind === 'review')
    expect(reviews.map((entry) => [(entry.actor as { by: string }).by.split(':')[1], entry.refs])).toEqual([
      ['alice', { run: 'r1' }],
      ['alice', { scope: 'agents' }]
    ])
    expect(verifyHistory(exported)).toMatchObject({ ok: true })
  })

  it('only a person who may edit reviews; reviews last through a restart', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-review-'))
    try {
      const first = await start(sqlite(join(folder, 'db.sqlite')))
      await first.create('news', 'h-6', 'example/article', { body: [paragraph('p', 'Harbour.')] })
      const agent = await open('agent:copy', 'h-6')
      paragraphOf(agent).insert(0, 'Cold. ')
      await until(() => !agent.hasUnsavedChanges)
      await expect(agent.review()).rejects.toMatchObject({ code: 'not-allowed' })
      const alice = await open('alice', 'h-6')
      await alice.review()
      clients.splice(0).forEach((client) => client.close())
      await first.close()
      servers.splice(0)

      const second = await start(sqlite(join(folder, 'db.sqlite')))
      expect(await second.unreviewed('news', 'h-6')).toEqual([])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('a history that survives a crash and shows a gap', () => {
  it('folds what the log holds beyond the history when the document is loaded again', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-recover-'))
    try {
      let crashed = false
      const store = sqlite(join(folder, 'db.sqlite'))
      // A store that keeps writing the log, but crashes before history is sealed
      const crashable = new Proxy(store, {
        get: (target, key: keyof Storage) => {
          const value = target[key]
          const stopped = ['appendHistory', 'checkpoint', 'unloaded']
          return typeof value === 'function' && stopped.includes(key)
            ? (...args: unknown[]) => (crashed ? Promise.resolve() : (value as (...a: unknown[]) => unknown).apply(target, args))
            : value
        }
      })
      const first = await start(crashable)
      await first.create('news', 'r-1', 'example/article', { body: [paragraph('p', 'Calm.')] })
      const bob = await open('bob', 'r-1')
      crashed = true
      await type(bob, 'Cold. ')

      const second = await start(sqlite(join(folder, 'db.sqlite')))
      const lines = await second.exportHistory('news', 'r-1')
      expect(verifyHistory(lines)).toMatchObject({ ok: true })
      const entries = parsed(lines)
      expect(entries.at(-1)).toMatchObject({ actor: { by: 'person:bob' }, refs: { recovered: 'true' } })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('finds a history that leaves out writes, even when its hashes link up', async () => {
    const server = await start()
    await server.create('news', 'r-2', 'example/article', { body: [paragraph('p', 'Calm.')] })
    const bob = await open('bob', 'r-2')
    await type(bob, 'One. ')
    const alice = await open('alice', 'r-2')
    await type(alice, 'Two. ')
    await type(bob, 'Three. ')
    const lines = (await server.exportHistory('news', 'r-2')).split('\n').filter(Boolean)
    expect(verifyHistory(lines)).toMatchObject({ ok: true })
    // Drop an entry and chain the rest again, as someone covering their tracks would
    const { seal } = await import('../lib/history')
    const kept = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((_, i) => i !== 1)
    let prev = '0'.repeat(64)
    const rechained = kept.map((entry, i) => {
      const fields: Record<string, unknown> = { ...entry, seq: i + 1 }
      for (const key of ['hash', 'payloadHash', 'prevHash', 'payload']) {
        delete fields[key]
      }
      if (entry.payload) {
        fields.payload = Buffer.from(String(entry.payload), 'base64')
      }
      const sealed = seal(fields as Parameters<typeof seal>[0], prev)
      prev = sealed.hash
      return sealed
    })
    const { toJSONLine } = await import('../lib/history')
    const verdict = verifyHistory(rechained.map(toJSONLine))
    expect(verdict).toMatchObject({ ok: false })
    expect((verdict as { reason: string }).reason).toMatch(/does not take up where the entry before left off/)
  })
})

describe('records in the history', () => {
  it('puts a record in the chain, beside the writes, by who made it', async () => {
    const server = await start()
    await server.create('news', 'rec-1', 'example/article', { body: [paragraph('p', 'Calm.')] })
    const bob = await open('bob', 'rec-1')
    await type(bob, 'Cold. ')
    bob.appendRecord('status.changed', { to: 'ready' })
    await until(() => bob.records.length === 1)
    await type(bob, 'Very. ')
    const lines = await server.exportHistory('news', 'rec-1')
    expect(verifyHistory(lines)).toMatchObject({ ok: true })
    const record = parsed(lines).find((entry) => entry.kind === 'record')
    expect(record).toMatchObject({ actor: { by: 'person:bob' }, refs: { record: '1', kind: 'status.changed' } })
  })
})

describe('signed histories', () => {
  it('signs the head at checkpoints and versions, and the verifier checks the signatures', async () => {
    const { generateKeyPairSync, sign } = await import('node:crypto')
    const ours = generateKeyPairSync('ed25519')
    const theirs = generateKeyPairSync('ed25519')
    const server = createServer({
      types: [article],
      storage: memory(),
      authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
      signer: { keyId: 'k1', sign: (message) => sign(null, message, ours.privateKey) },
      checkpointEvery: 2
    })
    servers.push(server)
    url = `ws://localhost:${((await server.listen(0)).address() as AddressInfo).port}`
    await server.create('news', 's-1', 'example/article', { body: [paragraph('p', 'Calm.')] })
    const bob = await open('bob', 's-1')
    await type(bob, 'One. ')
    await type(bob, 'Two. ')
    await type(bob, 'Three. ')
    const lines = (await server.exportHistory('news', 's-1')).split('\n').filter(Boolean)
    const entries = lines.map((line) => JSON.parse(line) as { kind: string })
    expect(entries.some((entry) => entry.kind === 'signature')).toBe(true)

    expect(verifyHistory(lines, { keys: { k1: ours.publicKey } })).toMatchObject({ ok: true })
    expect(verifyHistory(lines, { keys: { k1: theirs.publicKey } })).toMatchObject({ ok: false, reason: 'Its signature does not hold' })
    expect(verifyHistory(lines, { keys: {} })).toMatchObject({ ok: false })

    // Rewritten and chained again by someone with the store but not the key
    const { seal, toJSONLine } = await import('../lib/history')
    let prev = '0'.repeat(64)
    const rewritten = lines.map((line, i) => {
      const entry = JSON.parse(line) as Record<string, unknown>
      const fields: Record<string, unknown> = { ...entry, ...(i === 0 ? { at: 1 } : {}) }
      for (const key of ['hash', 'payloadHash', 'prevHash', 'payload']) {
        delete fields[key]
      }
      if (entry.payload) {
        fields.payload = Buffer.from(String(entry.payload), 'base64')
      }
      if (fields.kind === 'signature') {
        fields.refs = { ...(fields.refs as Record<string, string>), head: prev }
      }
      const sealed = seal(fields as Parameters<typeof seal>[0], prev)
      prev = sealed.hash
      return toJSONLine(sealed)
    })
    expect(verifyHistory(rewritten, { keys: { k1: ours.publicKey } })).toMatchObject({ ok: false, reason: 'Its signature does not hold' })
  })
})

describe('retention', () => {
  it('drops old payloads and log, keeps the chain verifiable and the document whole', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-prune-'))
    try {
      const server = await start(sqlite(join(folder, 'db.sqlite')))
      await server.create('news', 'p-1', 'example/article', { body: [paragraph('p', 'Calm.')] })
      const bob = await open('bob', 'p-1')
      await type(bob, 'One. ')
      await type(bob, 'Two. ')
      await server.prune('news', 'p-1', Date.now() + 1)

      const lines = (await server.exportHistory('news', 'p-1')).split('\n').filter(Boolean)
      expect(verifyHistory(lines)).toMatchObject({ ok: true })
      expect(lines.every((line) => !('payload' in (JSON.parse(line) as object)))).toBe(true)
      // The past between versions is gone, and said to be
      await expect(bob.version(1)).rejects.toThrow()

      const again = await start(sqlite(join(folder, 'db.sqlite')))
      expect(JSON.stringify(await again.read('news', 'p-1'))).toContain('Two. One. Calm.')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('who acted, by key', () => {
  it('keeps names out of the chain and in the register, which says who each key is', async () => {
    const server = await start()
    await server.create('news', 'k-1', 'example/article', { body: [paragraph('p', 'Calm.')] })
    const bob = await open('bob', 'k-1')
    await type(bob, 'Cold. ')
    const exported = await server.exportHistory('news', 'k-1')
    expect(exported).not.toContain('Bob')
    expect(parsed(exported).at(-1)).toMatchObject({ actor: { by: 'person:bob' } })
    expect(await server.people('news', 'k-1')).toMatchObject({ 'person:bob': { kind: 'person', id: 'bob', name: 'Bob' } })
  })
})
