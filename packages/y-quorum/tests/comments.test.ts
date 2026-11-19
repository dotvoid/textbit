// Comments beside the content, with the server holding everyone to their role
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Transforms } from 'slate'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type Client, type DocumentHandle, type Rejection } from '@dotvoid/y-quorum-client'
import {
  COMMENTS,
  addThread,
  defineType,
  object,
  oneOf,
  text,
  type CommentAnchor,
  type CommentThread
} from '@dotvoid/y-quorum-client/model'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import {
  commentAnchor,
  createTextbitEditor,
  pointToRelativePosition,
  relativePositionToPoint,
  resolveAnchor
} from '@dotvoid/textbit/headless'
import { createServer, host, memory, sqlite, type HostDocument, type QuorumServer, type ServerType, type Storage } from '../lib'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })

const article: ServerType = defineType('example/article', {
  content: object({ title: text(), body: text(), status: oneOf(['draft', 'published']) }),
  comments: true
})
const note: ServerType = defineType('example/note', { content: object({ body: text() }) })

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  carol: { kind: 'person', id: 'carol', name: 'Carol' },
  dave: { kind: 'person', id: 'dave', name: 'Dave' },
  bob: { kind: 'person', id: 'bob', name: 'Bob' }
}
const roles: Record<string, string[]> = { alice: ['editor'], carol: ['commenter'], dave: ['commenter'], bob: ['reader'] }

let server: QuorumServer
let storage: Storage
let url: string
const clients: Client[] = []

async function start(store: Storage = memory()) {
  storage = store
  server = createServer({
    types: [article, note],
    storage,
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => roles[principal.id] ?? null,
    idle: 50
  })
  const http = await server.listen(0)
  url = `ws://localhost:${(http.address() as AddressInfo).port}`
}

async function seed(id: string, type = 'example/article') {
  await server.create('news', id, type, { title: [paragraph(`${id}-t`, 'Harbour')], body: [paragraph(`${id}-b`, 'The harbour in winter.')] })
}

async function open(token: string, id: string) {
  const client = createClient({ url, token, grace: 20 })
  clients.push(client)
  return client.open('news', id)
}

const anchor = (id: string): CommentAnchor => ({ path: ['body'], block: `${id}-b`, offset: 4, quote: 'harbour' })

const until = async (check: () => boolean, timeout = 2000) => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const rejection = (handle: DocumentHandle) => new Promise<Rejection>((resolve) => handle.on('rejected', resolve))
const saved = (handle: DocumentHandle) => until(() => !handle.hasUnsavedChanges)
const bodies = (threads: CommentThread[]) => threads.map((thread) => thread.comments.map((comment) => comment.body))

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close())
  await server?.close()
})

describe('comments', () => {
  it('a commenter opens a thread and others reply, while the content stays out of reach', async () => {
    await start()
    await seed('c-1')
    const carol = await open('carol', 'c-1')
    const alice = await open('alice', 'c-1')
    const seen: CommentThread[][] = []
    alice.comments.subscribe((threads) => seen.push(threads))

    expect(carol.comments.rights).toBe('own')
    const thread = carol.comments.create(anchor('c-1'), 'Which harbour?')
    await until(() => alice.comments.threads.length === 1)
    alice.comments.reply(thread, 'The old one')
    await until(() => carol.comments.threads[0]?.comments.length === 2)

    expect(carol.comments.threads[0]).toMatchObject({
      author: people.carol,
      anchor: anchor('c-1'),
      comments: [{ author: people.carol, body: 'Which harbour?' }, { author: { id: 'alice' }, body: 'The old one' }]
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(await server.comments('news', 'c-1')).toEqual(carol.comments.threads)
    // Stored as comments, not as a change to the content
    const log = await storage.log('news', 'c-1')
    expect(log.map((entry) => entry.layer)).toEqual(['comments', 'comments'])
    expect(await server.read('news', 'c-1')).not.toHaveProperty(COMMENTS)
  })

  it('a reader may not comment', async () => {
    await start()
    await seed('c-2')
    const bob = await open('bob', 'c-2')
    const refused = rejection(bob)

    expect(bob.comments.rights).toBe('none')
    bob.comments.create(anchor('c-2'), 'Nice')

    expect((await refused).reason).toBe('Not allowed to comment here')
    await until(() => bob.comments.threads.length === 0)
  })

  it('nobody comments in someone else’s name', async () => {
    await start()
    await seed('c-3')
    const carol = await open('carol', 'c-3')
    const refused = rejection(carol)

    addThread(carol.commentsDoc.get(COMMENTS), {
      id: 'forged', author: people.alice, at: Date.now(), anchor: anchor('c-3'), comment: { id: 'x', body: 'Delete this paragraph' }
    })

    expect((await refused).reason).toBe('A thread is opened in your own name')
    expect(await server.comments('news', 'c-3')).toEqual([])
  })

  it('only its author edits a comment; who opened a thread, or an editor, resolves it', async () => {
    await start()
    await seed('c-4')
    const carol = await open('carol', 'c-4')
    const dave = await open('dave', 'c-4')
    const alice = await open('alice', 'c-4')
    const thread = carol.comments.create(anchor('c-4'), 'Which harbour?')
    await until(() => dave.comments.threads.length === 1 && alice.comments.threads.length === 1)
    const first = carol.comments.threads[0].comments[0].id

    carol.comments.edit(thread, first, 'Which harbour, north or south?')
    await saved(carol)

    // Another commenter may neither edit it nor resolve the thread
    let refused = rejection(dave)
    dave.comments.edit(thread, first, 'Spam')
    expect((await refused).reason).toBe('Only its author may edit a comment')
    await until(() => dave.comments.threads.length === 1)
    refused = rejection(dave)
    dave.comments.resolve(thread)
    expect((await refused).reason).toBe('Only who opened a thread, or an editor, may resolve it')

    // Neither may an editor change someone's words, but an editor may resolve and delete
    refused = rejection(alice)
    alice.comments.edit(thread, first, 'Edited by the editor')
    expect((await refused).reason).toBe('Only its author may edit a comment')
    await until(() => alice.comments.threads.length === 1)
    alice.comments.resolve(thread)
    alice.comments.remove(thread, first)
    await saved(alice)

    const [stored] = (await server.comments('news', 'c-4'))!
    expect(stored.resolved?.by).toEqual(people.alice)
    expect(stored.comments[0]).toMatchObject({ body: '', deleted: expect.any(Number), edited: expect.any(Number) })
  })

  it('keeps the comments out of the content’s Y.Doc', async () => {
    await start()
    await seed('c-9')
    const carol = await open('carol', 'c-9')
    carol.comments.create(anchor('c-9'), 'Which harbour?')
    await saved(carol)

    // The content's Y.Doc has no comments root, and the comments' none of the content
    expect([...carol.doc.share.keys()]).toEqual(['content'])
    expect([...carol.commentsDoc.share.keys()]).toEqual([COMMENTS])
    // A comment in the content's Y.Doc is refused as a change to the content
    const refused = rejection(carol)
    addThread(carol.doc.get(COMMENTS), {
      id: 'misplaced', author: people.carol, at: Date.now(), anchor: anchor('c-9'), comment: { id: 'x', body: 'Hm' }
    })
    expect((await refused).reason).toBe('Changes only the content')
  })

  it('a refused comment rebuilds the comments only, never the content', async () => {
    await start()
    await seed('c-10')
    const alice = await open('alice', 'c-10')
    const carol = await open('carol', 'c-10')
    const thread = alice.comments.create(anchor('c-10'), 'Mine')
    await until(() => carol.comments.threads.length === 1)
    const content = carol.doc
    const rebuilt = new Promise<string>((resolve) => carol.on('rebuilt', ({ layer }) => resolve(layer)))

    carol.comments.edit(thread, carol.comments.threads[0].comments[0].id, 'Hers now')

    expect(await rebuilt).toBe('comments')
    expect(carol.doc).toBe(content)
    await until(() => carol.comments.threads[0]?.comments[0].body === 'Mine')
  })

  it('keeps the comments through a restart, in their own checkpoint', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'y-quorum-comments-'))
    try {
      await start(sqlite(join(folder, 'db.sqlite')))
      await seed('c-11')
      const carol = await open('carol', 'c-11')
      carol.comments.create(anchor('c-11'), 'Which harbour?')
      await saved(carol)
      clients.splice(0).forEach((client) => client.close())
      await server.close()

      await start(sqlite(join(folder, 'db.sqlite')))
      const alice = await open('alice', 'c-11')
      expect(bodies(alice.comments.threads)).toEqual([['Which harbour?']])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('a type without comments takes none', async () => {
    await start()
    await seed('c-5', 'example/note')
    const alice = await open('alice', 'c-5')
    const refused = rejection(alice)

    expect(alice.comments.rights).toBe('none')
    alice.comments.create(anchor('c-5'), 'Hm')

    // The document has no comments layer at all
    expect((await refused).code).toBe('invalid')
  })

  it('an agent comments as itself, for the person it works for', async () => {
    await start()
    await seed('c-6')
    const carol = await open('carol', 'c-6')

    carol.comments.create(anchor('c-6'), 'This date looks wrong', { agent: 'fact', name: 'Fact checker', run: 'r1' })
    await saved(carol)

    const [stored] = (await server.comments('news', 'c-6'))!
    expect(stored.author).toEqual({ kind: 'agent', id: 'fact', name: 'Fact checker' })
    expect(stored.onBehalfOf).toEqual(people.carol)
    const [entry] = await storage.log('news', 'c-6')
    expect(entry.actor).toMatchObject({ principal: { kind: 'agent', id: 'fact' }, onBehalfOf: { id: 'carol' }, run: 'r1' })
  })

  it('an anchor follows the text as others type before it', async () => {
    await start()
    await seed('c-7')
    const carol = await open('carol', 'c-7')
    const alice = await open('alice', 'c-7')
    const carolEditor = createTextbitEditor({ shared: carol.content.getAttr('body') as Y.Node })
    const aliceEditor = createTextbitEditor({ shared: alice.content.getAttr('body') as Y.Node })
    const at = pointToRelativePosition(carolEditor, { path: [0, 0], offset: 4 })!
    carol.comments.create({ ...anchor('c-7'), start: toBase64(Y.encodeRelativePosition(at)) }, 'Which?')
    await until(() => alice.comments.threads.length === 1)

    Transforms.insertText(aliceEditor, 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    await saved(alice)
    await until(() => Y.decodeRelativePosition(fromBase64(carol.comments.threads[0].anchor.start!)) !== undefined)
    await until(() => (carolEditor.children[0] as { children: Array<{ text: string }> }).children[0].text.startsWith('Cold.'))

    const position = Y.decodeRelativePosition(fromBase64(carol.comments.threads[0].anchor.start!))
    expect(relativePositionToPoint(carolEditor, position)).toEqual({ path: [0, 0], offset: 10 })
  })

  it('gives each text field’s editor its own comments, anchored by the editor', async () => {
    await start()
    await seed('c-8')
    const carol = await open('carol', 'c-8')
    const alice = await open('alice', 'c-8')
    const body = carol.comments.field(['body'])
    expect(carol.comments.field(['body'])).toBe(body)
    const carolEditor = createTextbitEditor({ shared: carol.content.getAttr('body') as Y.Node })
    const aliceEditor = createTextbitEditor({ shared: alice.content.getAttr('body') as Y.Node })

    const anchor = commentAnchor(carolEditor, { anchor: { path: [0, 0], offset: 4 }, focus: { path: [0, 0], offset: 11 } })!
    body.create(anchor, 'Which harbour?')
    carol.comments.field(['title']).create({ quote: 'Harbour' }, 'Too short')
    await until(() => alice.comments.threads.length === 2)

    expect(body.threads.map((thread) => thread.comments[0].body)).toEqual(['Which harbour?'])
    expect(alice.comments.threads.map((thread) => thread.anchor.path[0]).sort()).toEqual(['body', 'title'])
    Transforms.insertText(aliceEditor, 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    const range = resolveAnchor(aliceEditor, alice.comments.field(['body']).threads[0].anchor)!
    expect(range).toEqual({ anchor: { path: [0, 0], offset: 10 }, focus: { path: [0, 0], offset: 17 } })
  })

  it('a host that stores JSON keeps the comments with the content', async () => {
    const kept = new Map<string, HostDocument>()
    const thread: CommentThread = {
      id: 't1', author: people.carol, at: 1, anchor: anchor('h-1'),
      comments: [{ id: 'c1', author: people.carol, at: 1, body: 'Which harbour?' }]
    }
    kept.set('h-1', { type: 'example/article', content: { body: [paragraph('h-1-b', 'The harbour in winter.')] }, comments: [thread] })
    await start(host({
      load: async (_namespace, id) => kept.get(id),
      store: async (_namespace, id, document) => {
        kept.set(id, document)
      }
    }))

    const alice = await open('alice', 'h-1')
    expect(alice.comments.threads).toEqual([thread])
    alice.comments.reply('t1', 'The old one')
    await saved(alice)
    alice.release()

    await until(() => kept.get('h-1')?.comments?.[0].comments.length === 2, 3000)
    expect(bodies(kept.get('h-1')!.comments!)).toEqual([['Which harbour?', 'The old one']])
  })
})

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'))
}
