// Versions of the content: made by saving, compared, and restored as a new change
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from '@y/y'
import { Node, Text, Transforms, type Descendant, type Element } from 'slate'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type DocumentHandle, type QuorumError } from '@dotvoid/y-quorum-client'
import { defineType, object, text, toJSON } from '@dotvoid/y-quorum-client/model'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { createServer, memory, sqlite, type QuorumServer, type ServerOptions, type ServerType, type Storage } from '../lib'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })
const article: ServerType = defineType('example/article', { content: object({ body: text() }), history: true })

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' },
  carol: { kind: 'person', id: 'carol', name: 'Carol' }
}
const roles: Record<string, string[]> = { alice: ['owner'], bob: ['editor'], carol: ['reader'] }

const servers: QuorumServer[] = []
const clients: Client[] = []
let url: string

async function start(storage: Storage = memory(), onSave?: ServerOptions['onSave']) {
  const server = createServer({
    types: [article],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => roles[principal.id] ?? null,
    ...(onSave ? { onSave } : {}),
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

const named = (handle: DocumentHandle, label: string) => handle.versions.find((version) => version.label === label)!
const body = (handle: DocumentHandle) => handle.content.getAttr('body') as Y.Node
const words = (handle: DocumentHandle) => Node.string(createTextbitEditor({ shared: body(handle) }))
const editorOf = (handle: DocumentHandle) => createTextbitEditor({ shared: body(handle) })
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

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  for (const server of servers.splice(0)) {
    await server.close()
  }
})

describe('versions', () => {
  it('a save makes a version everyone sees, holding the content as it was', async () => {
    const onSave = vi.fn()
    const server = await start(memory(), onSave)
    await server.create('news', 'v-1', 'example/article', { body: [paragraph('p', 'The harbour.')] })
    const bob = await open('bob', 'v-1')
    const alice = await open('alice', 'v-1')
    const told: string[] = []
    alice.on('versions', (added) => told.push(...added.map((version) => version.label ?? '')))

    await bob.save('First draft')
    Transforms.insertText(editorOf(bob), 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    await saved(bob)

    await until(() => told.length === 1)
    expect(told).toEqual(['First draft'])
    expect(alice.versions.map((version) => version.kind)).toEqual(['created', 'saved'])
    const version = alice.versions[1]
    expect(version).toMatchObject({ kind: 'saved', label: 'First draft', by: { id: 'bob', name: 'Bob' } })
    expect(onSave.mock.calls[0][0].version).toEqual(version)
    expect(toJSON((await alice.version(version.id)).get('content'), article.content)).toMatchObject({
      body: [{ children: [{ text: 'The harbour.' }] }]
    })
    expect(words(alice)).toBe('Cold. The harbour.')
  })

  it('compares a version with the content now: what was added and removed, and by whom', async () => {
    const server = await start()
    await server.create('news', 'v-2', 'example/article', { body: [paragraph('p', 'The old harbour.')] })
    const bob = await open('bob', 'v-2')
    await bob.save('Before')
    const editor = editorOf(bob)
    Transforms.delete(editor, { at: { anchor: { path: [0, 0], offset: 4 }, focus: { path: [0, 0], offset: 8 } } })
    Transforms.insertText(editor, ' in winter', { at: { path: [0, 0], offset: 'The harbour'.length } })
    await saved(bob)
    await until(() => !Y.createIdSetFromIdMap(bob.attributions().deletes).isEmpty())

    const { content, renderer } = await bob.compare(named(bob, 'Before').id)
    const view = createTextbitEditor({ shared: content.getAttr('body') as Y.Node, renderer })
    const pieces = ((view.children[0] as Element).children as Descendant[]).filter(Text.isText)
      .map((leaf) => [leaf.text, (leaf as { _suggested?: string })._suggested, (leaf as { _by?: string })._by])

    expect(pieces).toEqual([
      ['The ', undefined, undefined],
      ['old ', 'delete', 'person:bob'],
      ['harbour', undefined, undefined],
      [' in winter', 'insert', 'person:bob'],
      ['.', undefined, undefined]
    ])
  })

  it('an owner restores a version as a new change, after keeping the content as it was', async () => {
    const server = await start()
    await server.create('news', 'v-3', 'example/article', { body: [paragraph('p', 'The harbour.')] })
    const alice = await open('alice', 'v-3')
    const bob = await open('bob', 'v-3')
    await bob.save('Plain')
    Transforms.insertText(editorOf(bob), 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    Transforms.insertText(editorOf(bob), ' Quiet.', { at: { path: [0, 0], offset: 'Cold. The harbour.'.length } })
    await saved(bob)
    await until(() => words(alice) === 'Cold. The harbour. Quiet.')

    await alice.restore(named(alice, 'Plain').id)

    await until(() => words(bob) === 'The harbour.')
    expect(words(alice)).toBe('The harbour.')
    const backup = alice.versions.find((version) => version.kind === 'before-restore')!
    expect(backup).toMatchObject({ label: 'Before restoring Plain', by: { id: 'alice' } })

    // And the restore is undone by restoring what was kept
    await alice.restore(backup.id)
    await until(() => words(bob) === 'Cold. The harbour. Quiet.')
  })

  it('only those who may make versions save, and only owners restore', async () => {
    const server = await start()
    await server.create('news', 'v-4', 'example/article', { body: [paragraph('p', 'The harbour.')] })
    const carol = await open('carol', 'v-4')
    const bob = await open('bob', 'v-4')
    expect([carol.capabilities.versions, bob.capabilities.versions]).toEqual(['read', 'create'])

    await expect(carol.save('Mine')).rejects.toMatchObject({ code: 'not-allowed' } satisfies Partial<QuorumError>)
    await bob.save('Draft')
    await expect(bob.restore(named(bob, 'Draft').id)).rejects.toMatchObject({ code: 'not-allowed' })
    await expect(carol.version(named(bob, 'Draft').id)).resolves.toBeInstanceOf(Y.Doc)
  })

  it('goes back to any log position, and compares two of them', async () => {
    const server = await start()
    await server.create('news', 'v-6', 'example/article', { body: [paragraph('p', 'Harbour.')] })
    const bob = await open('bob', 'v-6')
    const at = (handle: DocumentHandle) => handle.log
    const text = async (seq: number) => (toJSON((await bob.version(seq)).get('content'), article.content).body as Array<{ children: Array<{ text: string }> }>)[0].children[0].text

    Transforms.insertText(editorOf(bob), 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    await saved(bob)
    const afterCold = at(bob)
    await bob.save('Middle')
    Transforms.insertText(editorOf(bob), 'Very. ', { at: { path: [0, 0], offset: 0 } })
    await saved(bob)

    expect(await text(0)).toBe('Harbour.')
    expect(await text(afterCold)).toBe('Cold. Harbour.')
    expect(await text(bob.log)).toBe('Very. Cold. Harbour.')
    const { content, renderer } = await bob.compare(0, afterCold)
    const view = createTextbitEditor({ shared: content.getAttr('body') as Y.Node, renderer })
    expect(((view.children[0] as Element).children as Descendant[]).filter(Text.isText)
      .map((leaf) => [leaf.text, (leaf as { _suggested?: string })._suggested])).toEqual([['Cold. ', 'insert'], ['Harbour.', undefined]])
  })

  it('keeps versions through a restart', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-versions-'))
    try {
      const first = await start(sqlite(join(folder, 'db.sqlite')))
      await first.create('news', 'v-5', 'example/article', { body: [paragraph('p', 'The harbour.')] })
      const bob = await open('bob', 'v-5')
      await bob.save('Kept')
      clients.splice(0).forEach((client) => client.close())
      await first.close()
      servers.splice(0)

      await start(sqlite(join(folder, 'db.sqlite')))
      const alice = await open('alice', 'v-5')
      expect(alice.versions.map((version) => version.label)).toEqual(['Created', 'Kept'])
      expect(toJSON((await alice.version(named(alice, 'Kept').id)).get('content'), article.content)).toMatchObject({
        body: [{ children: [{ text: 'The harbour.' }] }]
      })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
