// The MCP module, end to end: a y-quorum server, the module mounted over HTTP,
// and an MCP client calling it as an agent working for a person
import { afterEach, describe, expect, it } from 'vitest'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { defineType, object, oneOf, text } from '@dotvoid/y-quorum-client/model'
import { createServer, memory, type QuorumServer, type ServerType, type Storage } from '../lib'
import { createMcpModule, type McpModule } from '../lib/mcp'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })
const article: ServerType = defineType('example/article', {
  content: object({ title: text(), body: text(), status: oneOf(['draft', 'ready', 'published']) }),
  comments: true,
  suggestions: true,
  history: true
})

const note: ServerType = defineType('example/note', { content: object({ body: text() }) })

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  sam: { kind: 'person', id: 'sam', name: 'Sam' }
}
const roles: Record<string, string[]> = { alice: ['editor'], sam: ['suggester'] }

let server: QuorumServer
let storage: Storage
let module: McpModule
let http: HttpServer
let mcpUrl: string
const clients: Client[] = []

async function start() {
  storage = memory()
  server = createServer({
    types: [article, note],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => roles[principal.id] ?? null
  })
  const quorum = await server.listen(0)
  await server.create('news', 'a-1', 'example/article', {
    title: [paragraph('t', 'Harbour')],
    body: [paragraph('p1', 'The boats rest in the harbour.'), paragraph('p2', 'Teh town is quiet.')],
    status: 'draft'
  })
  module = createMcpModule({
    url: `ws://localhost:${(quorum.address() as AddressInfo).port}`,
    types: [article, note],
    plugins: { default: [] },
    // "Bearer <person>:<agent>": the host decides who calls; here, plainly
    identify: (request) => {
      const [person, agent] = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '').split(':')
      return people[person] && agent ? { key: `${person}:${agent}`, token: person, agent: { id: agent, name: 'Copy editor', model: 'test-model' } } : null
    },
    documents: async () => ({ documents: [{ namespace: 'news', id: 'a-1', type: 'example/article', title: 'Harbour' }] }),
    // Agents only suggest in a document that is ready
    agentPolicy: ({ content }) => (content.status === 'ready' ? 'suggest' : 'edit')
  })
  http = createHttpServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = []
    for await (const chunk of incoming) {
      chunks.push(chunk as Buffer)
    }
    const request = new Request(`http://localhost${incoming.url}`, {
      method: incoming.method,
      headers: Object.entries(incoming.headers).flatMap(([key, value]) => (value === undefined ? [] : [[key, String(value)] as [string, string]])),
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {})
    })
    const response = await module.fetch(request)
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      headers[key] = value
    })
    outgoing.writeHead(response.status, headers)
    outgoing.end(Buffer.from(await response.arrayBuffer()))
  })
  await new Promise<void>((resolve) => http.listen(0, resolve))
  mcpUrl = `http://localhost:${(http.address() as AddressInfo).port}/mcp`
}

async function connect(who: string) {
  const client = new Client({ name: 'test-agent', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${who}` } } }))
  clients.push(client)
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? ''
  return { error: Boolean(result.isError), text }
}

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close()
  }
  await module?.close()
  await new Promise<void>((resolve) => (http ? http.close(() => resolve()) : resolve()))
  await server?.close()
})

describe('agents over MCP', () => {
  it('lists its tools, and refuses a caller the host does not know', async () => {
    await start()
    const alice = await connect('alice:copy')
    const { tools } = await alice.listTools()
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'documents_list', 'document_fields', 'document_set_field', 'document_read', 'document_search', 'document_types',
      'document_edit', 'document_suggest', 'suggestions_list', 'comments_list', 'comment_create', 'comment_reply'
    ]))
    const refused = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(refused.status).toBe(401)
  })

  it('finds, reads and edits a document, every change the agent’s, for the person', async () => {
    await start()
    const alice = await connect('alice:copy')
    expect((await call(alice, 'documents_list', {})).text).toContain('news/a-1 (example/article): Harbour')
    const fields = JSON.parse((await call(alice, 'document_fields', { doc: 'news/a-1' })).text) as { agents: string, textFields: string[] }
    expect(fields).toMatchObject({ agents: 'edit', textFields: ['title', 'body'] })

    const read = await call(alice, 'document_read', { doc: 'news/a-1', field: 'body' })
    const revision = read.text.match(/revision: (\S+)/)![1]
    const second = read.text.split('\n').find((line) => line.includes('Teh town'))!.match(/\[#(\S+)/)![1]
    const edit = await call(alice, 'document_edit', {
      doc: 'news/a-1', field: 'body', revision,
      operations: [{ op: 'replaceText', id: second, find: 'Teh', replace: 'The' }]
    })
    expect(edit.error).toBe(false)
    await expect.poll(async () => JSON.stringify(await server.read('news', 'a-1'))).toContain('The town is quiet.')
    await expect.poll(async () => (await storage.log('news', 'a-1')).length).toBeGreaterThan(0)
    const [entry] = await storage.log('news', 'a-1')
    expect(entry.actor).toMatchObject({ principal: { kind: 'agent', id: 'copy', name: 'Copy editor' }, onBehalfOf: people.alice, model: 'test-model' })
  })

  it('suggests where the host says agents only suggest, and lists what it suggested', async () => {
    await start()
    const alice = await connect('alice:copy')
    const set = await call(alice, 'document_set_field', { doc: 'news/a-1', path: 'status', value: 'ready' })
    expect(set.error).toBe(false)
    await expect.poll(async () => (await server.read('news', 'a-1'))?.status).toBe('ready')

    const read = await call(alice, 'document_read', { doc: 'news/a-1' })
    const revision = read.text.match(/revision: (\S+)/)![1]
    const handle = read.text.split('\n').find((line) => line.includes('Harbour'))!.match(/\[#(\S+)/)![1]
    const operations = [{ op: 'replaceText', id: handle, find: 'Harbour', replace: 'Winter harbour' }]
    const refused = await call(alice, 'document_edit', { doc: 'news/a-1', revision, operations })
    expect(refused).toMatchObject({ error: true })
    expect(refused.text).toContain('suggest instead, with document_suggest')

    expect((await call(alice, 'document_suggest', { doc: 'news/a-1', revision, operations })).error).toBe(false)
    await expect.poll(async () => (await call(alice, 'suggestions_list', { doc: 'news/a-1' })).text).toContain('agent:copy')
    expect(JSON.stringify((await server.read('news', 'a-1'))?.title)).toContain('"Harbour"')
  })

  it('never does more than the person may: a suggester’s agent suggests and comments, but does not edit', async () => {
    await start()
    const sam = await connect('sam:copy')
    const fields = JSON.parse((await call(sam, 'document_fields', { doc: 'news/a-1' })).text) as { agents: string }
    expect(fields.agents).toBe('suggest')
    expect((await call(sam, 'document_set_field', { doc: 'news/a-1', path: 'status', value: 'published' })).error).toBe(true)

    const made = await call(sam, 'comment_create', { doc: 'news/a-1', field: 'body', quote: 'Teh town', body: 'A typo?' })
    expect(made.error).toBe(false)
    await expect.poll(async () => (await call(sam, 'comments_list', { doc: 'news/a-1' })).text).toContain('A typo?')
    const [thread] = (await server.comments('news', 'a-1'))!
    expect(thread.author).toMatchObject({ kind: 'agent', id: 'copy' })
    expect(thread.onBehalfOf).toMatchObject({ id: 'sam' })
  })

  it('says there is nothing to comment on in a type without comments, before writing anything', async () => {
    await start()
    await server.create('news', 'n-1', 'example/note', { body: [paragraph('n', 'A note.')] })
    const alice = await connect('alice:copy')
    const made = await call(alice, 'comment_create', { doc: 'news/n-1', quote: 'A note', body: 'Hm.' })
    expect(made).toMatchObject({ error: true })
    expect(made.text).toContain('no comments')
  })
})
