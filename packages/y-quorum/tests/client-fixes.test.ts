// The client against the real server: what a review of the client found
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Node } from 'slate'
import type { AddressInfo } from 'node:net'
import { createClient, type Client } from '@dotvoid/y-quorum-client'
import { defineType, object, text } from '@dotvoid/y-quorum-client/model'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { createServer, memory, type QuorumServer, type ServerType } from '../lib'

const paragraph = (id: string, words: string) =>
  ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })
const article: ServerType = defineType('example/article', {
  content: object({ body: text() }),
  suggestions: true,
  history: true
})
const people: Record<string, Principal> = { alice: { kind: 'person', id: 'alice', name: 'Alice' } }

let server: QuorumServer
let url: string
const clients: Client[] = []

async function start() {
  server = createServer({
    types: [article],
    storage: memory(),
    authenticate: (token) =>
      (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => (principal.id === 'alice' ? ['editor'] : null),
    idle: 50
  })
  const http = await server.listen(0)
  url = `ws://localhost:${(http.address() as AddressInfo).port}`
}

async function open(token: string, id: string) {
  if (!(await server.read('news', id))) {
    const body = [paragraph('p', 'Write 600 words.')]
    await server.create('news', id, 'example/article', { body })
  }
  const client = createClient({ url, token, grace: 20 })
  clients.push(client)
  return client.open('news', id)
}

const field = (doc: Y.Doc) => doc.get('content').getAttr('body') as Y.Node
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
  await server?.close()
})

describe('suggesting a revert', () => {
  it('says the fork changed only when it did', async () => {
    await start()
    const alice = await open('alice', 'r-1')
    const run = alice.claimOrigin({ agent: 'copy', run: 'r1' })
    alice.doc.transact(() => (field(alice.doc).get(0) as Y.Node).insert(0, 'Please '), run)
    await until(() => !alice.hasUnsavedChanges)
    await until(() => !Y.createIdSetFromIdMap(alice.attributions().inserts).isEmpty())

    expect(alice.suggestRevert({ run: 'r1' })).toBe(true)
    const fork = Y.encodeStateAsUpdate(alice.suggestionsDoc)
    // Suggested taken back already: nothing more to do
    expect(alice.suggestRevert({ run: 'r1' })).toBe(false)
    expect(Y.encodeStateAsUpdate(alice.suggestionsDoc)).toEqual(fork)
    await until(() => !alice.hasUnsavedChanges)
    const text = Node.string(createTextbitEditor({ shared: field(alice.doc) }))
    expect(text).toBe('Please Write 600 words.')
  })
})
