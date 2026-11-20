import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from '@y/y'
import { createClient, type Client, type DocumentHandle, type Rejection } from '../lib/client'
import { ToServer } from '../lib/protocol'
import { startServer, waitFor, type FakeServer } from './fakeServer'

let server: FakeServer
let clients: Client[]

beforeEach(async () => {
  server = await startServer()
  server.doc.get('content').setAttr('title', 'From the server')
  clients = []
})

afterEach(async () => {
  for (const client of clients) {
    client.close()
  }
  await server.close()
})

function connect(token = 'good'): Client {
  const client = createClient({ url: server.url, token: async () => token, grace: 30 })
  clients.push(client)
  return client
}

describe('the client', () => {
  it('says hello and is welcomed', async () => {
    const client = connect()
    const welcome = await client.ready
    expect(welcome.principal.id).toBe('p1')
    expect(client.principal?.name).toBe('Pat')
    expect(client.status).toBe('connected')
    expect(server.framesOf(ToServer.HELLO)[0].header).toEqual({ protocol: 1, token: 'good' })
  })

  it('is refused for good with a bad token', async () => {
    const client = connect('bad')
    const refusals: string[] = []
    client.on('refused', (refusal) => refusals.push(refusal.code))
    await expect(client.ready).rejects.toMatchObject({ code: 'unauthenticated' })
    await waitFor(() => client.status === 'closed')
    expect(refusals).toEqual(['unauthenticated'])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(server.framesOf(ToServer.HELLO)).toHaveLength(1)
  })

  it('opens a document with what the server has', async () => {
    const client = connect()
    const handle = await client.open('plans', 'one')
    expect(handle.type).toBe('test/doc')
    expect(handle.incarnation).toBe('one')
    expect(handle.capabilities.write).toBe(true)
    expect(handle.content.getAttr('title')).toBe('From the server')
    const open = server.framesOf(ToServer.OPEN)[0]
    expect(open.header).toMatchObject({ namespace: 'plans', id: 'one', mode: 'open' })
    expect(open.header.clientId).toBe(handle.doc.clientID)
  })

  it('sends local changes, and knows when they are stored', async () => {
    const client = connect()
    const handle = await client.open('plans', 'one')
    const saved = new Promise<{ log?: number }>((resolve) => handle.on('saved', resolve))
    handle.content.setAttr('status', 'done')
    expect(handle.hasUnsavedChanges).toBe(true)
    expect((await saved).log).toBe(1)
    expect(handle.hasUnsavedChanges).toBe(false)
    expect(server.doc.get('content').getAttr('status')).toBe('done')
    expect(server.framesOf(ToServer.UPDATE)[0].header).toMatchObject({ layer: 'content', seq: 1 })
  })

  it('applies changes from others', async () => {
    const client = connect()
    const handle = await client.open('plans', 'one')
    server.doc.get('content').setAttr('title', 'Changed elsewhere')
    await waitFor(() => handle.content.getAttr('title') === 'Changed elsewhere')
    // What came from the server is not sent back
    expect(server.framesOf(ToServer.UPDATE)).toHaveLength(0)
    expect(handle.hasUnsavedChanges).toBe(false)
  })

  it('sends changes made under a claim in frames that carry it', async () => {
    const client = connect()
    const handle = await client.open('plans', 'one')
    const origin = handle.claimOrigin({ agent: 'helper', model: 'm1' })
    handle.doc.transact(() => handle.content.setAttr('status', 'todo'), origin)
    handle.content.setAttr('status', 'done')
    await waitFor(() => server.framesOf(ToServer.UPDATE).length === 2)
    const [claimed, plain] = server.framesOf(ToServer.UPDATE)
    expect(claimed.header.claim).toEqual({ agent: 'helper', model: 'm1' })
    expect(plain.header.claim).toBeUndefined()
  })

  it('shares one document between handles and closes it after the last is released', async () => {
    const client = connect()
    const first = await client.open('plans', 'one')
    const second = await client.open('plans', 'one')
    expect(second).not.toBe(first)
    expect(second.doc).toBe(first.doc)
    expect(second.awareness).toBe(first.awareness)
    expect(server.framesOf(ToServer.OPEN)).toHaveLength(1)

    first.release()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(server.framesOf(ToServer.CLOSE)).toHaveLength(0)

    // Released and opened again within the grace period: the same document
    second.release()
    const third = await client.open('plans', 'one')
    expect(third.doc).toBe(first.doc)
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(server.framesOf(ToServer.CLOSE)).toHaveLength(0)

    third.release()
    await waitFor(() => server.framesOf(ToServer.CLOSE).length === 1)
    const fourth = await client.open('plans', 'one')
    expect(fourth.doc).not.toBe(first.doc)
    expect(server.framesOf(ToServer.OPEN)).toHaveLength(2)
  })

  it('rebuilds a document under a new client id when a change is refused', async () => {
    const client = connect()
    const handle = await client.open('plans', 'one')
    const other = await client.open('plans', 'one')
    const old = handle.doc
    const events: string[] = []
    let rejection: Rejection | undefined
    other.on('rejected', (event) => {
      events.push('rejected')
      rejection = event
    })
    other.on('rebuilt', () => events.push('rebuilt'))

    server.refuseNextUpdate = true
    handle.content.setAttr('status', 'refused')
    handle.content.setAttr('note', 'depends on it')
    await waitFor(() => events.length === 2)

    expect(events).toEqual(['rejected', 'rebuilt'])
    expect(rejection?.code).toBe('not-allowed')
    expect(rejection?.updates).toHaveLength(2)
    const kept = new Y.Doc()
    for (const update of rejection?.updates ?? []) {
      Y.applyUpdate(kept, update)
    }
    expect(kept.get('content').getAttr('note')).toBe('depends on it')

    expect(handle.doc).not.toBe(old)
    expect(other.doc).toBe(handle.doc)
    expect(handle.doc.clientID).not.toBe(old.clientID)
    expect(handle.content.getAttr('title')).toBe('From the server')
    expect(handle.content.getAttr('status')).toBeUndefined()
    expect(handle.hasUnsavedChanges).toBe(false)
    const [, reopen] = server.framesOf(ToServer.OPEN)
    expect(reopen.header.clientId).toBe(handle.doc.clientID)
    expect(Y.decodeStateVector(reopen.payload).size).toBe(0)
    expect(server.framesOf(ToServer.CLOSE)).toHaveLength(1)

    // The new document syncs again
    handle.content.setAttr('status', 'again')
    await waitFor(() => server.doc.get('content').getAttr('status') === 'again')
  })

  it('takes another client id when its own is taken', async () => {
    const client = connect()
    server.takeNextClientId = true
    const handle = await client.open('plans', 'one')
    const [first, second] = server.framesOf(ToServer.OPEN)
    expect(second.header.clientId).not.toBe(first.header.clientId)
    expect(handle.doc.clientID).toBe(second.header.clientId)
    expect(handle.awareness.clientID).toBe(handle.doc.clientID)
    expect(handle.content.getAttr('title')).toBe('From the server')
  })

  it('reopens its documents after reconnecting and sends what was written offline', async () => {
    const client = connect()
    const handle = await client.open('plans', 'one')
    server.drop()
    await waitFor(() => client.status === 'disconnected')
    handle.content.setAttr('status', 'offline')
    expect(handle.hasUnsavedChanges).toBe(true)
    await waitFor(() => client.status === 'connected')
    await waitFor(() => server.doc.get('content').getAttr('status') === 'offline')
    await waitFor(() => !handle.hasUnsavedChanges)
    const opens = server.framesOf(ToServer.OPEN)
    expect(opens).toHaveLength(2)
    expect(opens[1].header).toMatchObject({ clientId: handle.doc.clientID, incarnation: 'one' })
    expect(server.framesOf(ToServer.HELLO)).toHaveLength(2)
  })

  it('watches fields of a document', async () => {
    const client = connect()
    const watch = await client.watch('plans', 'one', ['title'])
    expect(watch.value).toEqual({ title: 'From the server' })
    const changed = new Promise<Record<string, unknown>>((resolve) => watch.on('change', resolve))
    server.doc.get('content').setAttr('title', 'Renamed')
    expect(await changed).toEqual({ title: 'Renamed' })
    const [open] = server.framesOf(ToServer.OPEN)
    expect(open.header).toMatchObject({ mode: 'watch', paths: ['title'] })
  })

  it('refuses locally beyond the limits', async () => {
    server.limits = { open: 1, watch: 0, frame: 1000 }
    const client = connect()
    await client.open('plans', 'one')
    await expect(client.open('plans', 'two')).rejects.toMatchObject({ code: 'over-limit' })
    await expect(client.watch('plans', 'one', ['title']))
      .rejects.toMatchObject({ code: 'over-limit' })
    expect(server.framesOf(ToServer.OPEN)).toHaveLength(1)
  })

  it('answers calls and saves', async () => {
    const client = connect()
    expect(await client.rpc('echo', { a: 1 })).toEqual({ name: 'echo', args: { a: 1 } })
    await expect(client.rpc('fail')).rejects.toMatchObject({ code: 'not-allowed' })
    const handle = await client.open('plans', 'one')
    handle.content.setAttr('status', 'done')
    expect(await handle.save('First draft')).toBe(1)
    const [save] = server.framesOf(ToServer.SAVE)
    expect(save.header.label).toBe('First draft')
    expect(save.payload).toEqual(Y.encodeStateVector(handle.doc))
  })
})

describe('the fork and its renderers', () => {
  // A document whose type has comments and suggestions, its fork following the content
  async function forked(): Promise<DocumentHandle> {
    server.layered = true
    const handle = await connect().open('plans', 'one')
    await waitFor(() => fork(handle).getAttr('title') === 'From the server')
    return handle
  }
  const fork = (handle: DocumentHandle) => handle.suggestionsDoc.get('content')
  const suggested = () => server.framesOf(ToServer.UPDATE)
    .filter((frame) => frame.header.layer === 'suggestions')

  it('keeps the presence and the renderers when only the comments are rebuilt', async () => {
    const handle = await forked()
    const awareness = handle.awareness
    awareness.setLocalState({ name: 'Pat' })
    handle.suggestionsRenderer({ suggesting: false })
    const rebuilt = new Promise<{ layer: string }>((resolve) => handle.on('rebuilt', resolve))
    server.refuseNextUpdate = true
    handle.commentsDoc.get('comments').setAttr('note', 'refused')
    expect((await rebuilt).layer).toBe('comments')

    expect(handle.awareness).toBe(awareness)
    expect(awareness.getLocalState()).toEqual({ name: 'Pat' })
    // The content's listener now comes after the renderer's: what the
    // renderer passes on to the fork is still not suggested
    handle.content.setAttr('status', 'done')
    await waitFor(() => !handle.hasUnsavedChanges)
    expect(server.doc.get('content').getAttr('status')).toBe('done')
    expect(fork(handle).getAttr('status')).toBe('done')
    expect(suggested()).toHaveLength(0)

    // The renderer still passes typing on to the content
    fork(handle).setAttr('note', 'typed')
    expect(handle.content.getAttr('note')).toBe('typed')
  })

  it('destroys the renderers of a rebuilt content and fork', async () => {
    const handle = await forked()
    const renderer = handle.suggestionsRenderer({ suggesting: false })
    const destroyed = vi.spyOn(renderer, 'destroy')
    const oldFork = handle.suggestionsDoc
    const layers: string[] = []
    handle.on('rebuilt', ({ layer }) => layers.push(layer))
    server.refuseNextUpdate = true
    handle.content.setAttr('status', 'refused')
    await waitFor(() => layers.length === 2)

    expect(layers.sort()).toEqual(['content', 'suggestions'])
    expect(destroyed).toHaveBeenCalled()
    oldFork.get('content').setAttr('note', 'into the old fork')
    expect(handle.content.getAttr('note')).toBeUndefined()
  })

  it('lets a renderer go when it is destroyed', async () => {
    const handle = await forked()
    const editing = handle.suggestionsRenderer({ suggesting: false })
    const attributions = handle.attributionsRenderer()
    editing.destroy()
    attributions.destroy()
    handle.suggestionsRenderer()
    fork(handle).setAttr('note', 'suggested')
    expect(handle.content.getAttr('note')).toBeUndefined()

    const again = [vi.spyOn(editing, 'destroy'), vi.spyOn(attributions, 'destroy')]
    handle.release()
    expect(again.map((spy) => spy.mock.calls.length)).toEqual([0, 0])
  })

  it('passes on to the content only the origins it is given', async () => {
    const handle = await forked()
    const mine = {}
    handle.suggestionsRenderer({ suggesting: false, origins: [mine] })
    handle.suggestionsDoc.transact(() => fork(handle).setAttr('theirs', 'suggested'), {})
    handle.suggestionsDoc.transact(() => fork(handle).setAttr('mine', 'typed'), mine)
    expect(handle.content.getAttr('theirs')).toBeUndefined()
    expect(handle.content.getAttr('mine')).toBe('typed')
  })
})
