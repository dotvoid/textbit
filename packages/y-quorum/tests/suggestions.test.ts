// Suggestions in a fork of the content, as Y.js 14 makes them
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import { Node, Text, Transforms, type Descendant, type Editor, type Element } from 'slate'
import type { AddressInfo } from 'node:net'
import { createClient, type Client, type DocumentHandle, type Rejection } from '@dotvoid/y-quorum-client'
import { defineType, object, text } from '@dotvoid/y-quorum-client/model'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { createServer, memory, type QuorumServer, type ServerType } from '../lib'

const paragraph = (id: string, words: string) => ({ id, type: 'base/text', class: 'text', children: [{ text: words }] })
const article: ServerType = defineType('example/article', { content: object({ body: text() }), suggestions: true, history: true })
const note: ServerType = defineType('example/note', { content: object({ body: text() }) })

const people: Record<string, Principal> = {
  alice: { kind: 'person', id: 'alice', name: 'Alice' },
  sam: { kind: 'person', id: 'sam', name: 'Sam' },
  tess: { kind: 'person', id: 'tess', name: 'Tess' },
  carol: { kind: 'person', id: 'carol', name: 'Carol' }
}
const roles: Record<string, string[]> = { alice: ['editor'], sam: ['suggester'], tess: ['suggester'], carol: ['reader'] }

let server: QuorumServer
let url: string
const clients: Client[] = []

async function start() {
  server = createServer({
    types: [article, note],
    storage: memory(),
    authenticate: (token) => (people[token] ? { principal: people[token], namespaces: ['news'] } : null),
    authorize: ({ principal }) => roles[principal.id] ?? null,
    idle: 50
  })
  const http = await server.listen(0)
  url = `ws://localhost:${(http.address() as AddressInfo).port}`
}

async function open(token: string, id: string, type = 'example/article') {
  if (!(await server.read('news', id))) {
    await server.create('news', id, type, { body: [paragraph('p', 'Write 600 words.')] })
  }
  const client = createClient({ url, token, grace: 20 })
  clients.push(client)
  return client.open('news', id)
}

const field = (doc: Y.Doc) => doc.get('content').getAttr('body') as Y.Node
// An editor on the fork, through the difference with the content
const suggesting = (handle: DocumentHandle, options?: { suggesting?: boolean }) => {
  const renderer = handle.suggestionsRenderer(options)
  return { renderer, editor: createTextbitEditor({ shared: field(handle.suggestionsDoc), renderer }) }
}
const content = (handle: DocumentHandle) => Node.string(createTextbitEditor({ shared: field(handle.doc) }))
const pieces = (editor: Editor) => ((editor.children[0] as Element).children as Descendant[]).filter(Text.isText)
  .map((leaf) => [leaf.text, (leaf as { _suggested?: string })._suggested ?? ''])
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
  await server?.close()
})

describe('suggestions', () => {
  it('a suggester suggests, the content stays as it was, and an editor accepts', async () => {
    await start()
    const sam = await open('sam', 's-1')
    const alice = await open('alice', 's-1')
    expect([sam.capabilities.suggestions, alice.capabilities.suggestions]).toEqual(['own', 'all'])
    const { editor } = suggesting(sam)

    Transforms.insertText(editor, 'about ', { at: { path: [0, 0], offset: 'Write '.length } })
    await saved(sam)

    expect(pieces(editor)).toEqual([['Write ', ''], ['about ', 'insert'], ['600 words.', '']])
    expect(content(sam)).toBe('Write 600 words.')
    const review = suggesting(alice)
    await until(() => pieces(review.editor).length === 3)
    expect(content(alice)).toBe('Write 600 words.')

    review.renderer.acceptAllChanges()
    await saved(alice)
    await until(() => content(sam) === 'Write about 600 words.')
    expect(pieces(editor)).toEqual([['Write about 600 words.', '']])
  })

  it('what the content gets meanwhile shows in the fork', async () => {
    await start()
    const sam = await open('sam', 's-2')
    const alice = await open('alice', 's-2')
    const { editor } = suggesting(sam)
    Transforms.insertText(editor, 'Please ', { at: { path: [0, 0], offset: 0 } })
    await saved(sam)

    Transforms.insertText(createTextbitEditor({ shared: field(alice.doc) }), ' Today.', { at: { path: [0, 0], offset: 'Write 600 words.'.length } })
    await saved(alice)

    await until(() => Node.string(editor.children[0]) === 'Please Write 600 words. Today.')
    expect(pieces(editor)).toEqual([['Please ', 'insert'], ['Write 600 words. Today.', '']])
  })

  it('an editor rejects; a suggester withdraws their own, never someone else’s', async () => {
    await start()
    const sam = await open('sam', 's-3')
    const tess = await open('tess', 's-3')
    const alice = await open('alice', 's-3')
    Transforms.insertText(suggesting(sam).editor, 'Please ', { at: { path: [0, 0], offset: 0 } })
    await saved(sam)
    const tessView = suggesting(tess)
    await until(() => pieces(tessView.editor).length === 2)

    // Tess may not take Sam's suggestion away
    const refused = new Promise<Rejection>((resolve) => tess.on('rejected', resolve))
    tessView.renderer.rejectAllChanges()
    expect((await refused).reason).toBe('Only its author, or an editor, withdraws a suggestion')

    // Alice may
    const review = suggesting(alice)
    await until(() => pieces(review.editor).length === 2)
    review.renderer.rejectAllChanges()
    await saved(alice)
    const samView = suggesting(sam)
    await until(() => pieces(samView.editor).length === 1)
    expect(content(sam)).toBe('Write 600 words.')
  })

  it('a reader may not suggest, and a type without suggestions keeps none', async () => {
    await start()
    const carol = await open('carol', 's-4')
    const refused = new Promise<Rejection>((resolve) => carol.on('rejected', resolve))
    Transforms.insertText(suggesting(carol).editor, 'Hm ', { at: { path: [0, 0], offset: 0 } })
    expect((await refused).reason).toBe('Not allowed to suggest here')

    const alice = await open('alice', 's-5', 'example/note')
    expect(alice.capabilities.suggestions).toBeUndefined()
    expect([...alice.suggestionsDoc.share.keys()]).toEqual([])
  })

  it('who suggested what comes with the suggestion', async () => {
    await start()
    const sam = await open('sam', 's-6')
    const alice = await open('alice', 's-6')
    Transforms.insertText(suggesting(sam).editor, 'Please ', { at: { path: [0, 0], offset: 0 } })
    await saved(sam)
    await until(() => !Y.createIdSetFromIdMap(alice.attributions('suggestions').inserts).isEmpty())

    const { editor } = suggesting(alice)
    expect(((editor.children[0] as Element).children[0] as { _by?: string })._by).toBe('person:sam')
  })

  it('a suggester withdraws their own but never accepts; the history says who accepted and rejected', async () => {
    await start()
    const sam = await open('sam', 's-7')
    const alice = await open('alice', 's-7')
    const mine = suggesting(sam)
    Transforms.insertText(mine.editor, 'Please ', { at: { path: [0, 0], offset: 0 } })
    await saved(sam)

    // Accepting is an editor's
    const refused = new Promise<Rejection>((resolve) => sam.on('rejected', resolve))
    mine.renderer.acceptAllChanges()
    expect((await refused).reason).toBe('Only an editor accepts a suggestion')
    await until(() => content(sam) === 'Write 600 words.')

    // Withdrawing one's own is not
    const again = suggesting(sam)
    await until(() => pieces(again.editor).length === 2)
    again.renderer.rejectAllChanges()
    await saved(sam)
    await until(() => pieces(suggesting(alice).editor).length === 1)

    // Suggested again, and accepted by Alice
    const third = suggesting(sam)
    Transforms.insertText(third.editor, 'Kindly ', { at: { path: [0, 0], offset: 0 } })
    await saved(sam)
    const review = suggesting(alice)
    await until(() => pieces(review.editor).length === 2)
    review.renderer.acceptAllChanges()
    await saved(alice)
    await until(() => content(sam) === 'Kindly Write 600 words.')

    const kinds = (await server.exportHistory('news', 's-7')).split('\n').map((line) => JSON.parse(line) as { kind: string, actor: { principal: { id: string } } })
      .filter((entry) => entry.kind !== 'edit').map((entry) => [entry.kind, entry.actor.principal.id])
    expect(kinds).toEqual([['reject', 'sam'], ['accept', 'alice']])
  })

  it('names who suggested in a view open before the suggestion came, and in the suggester’s own', async () => {
    await start()
    const sam = await open('sam', 's-8')
    const alice = await open('alice', 's-8')
    const review = suggesting(alice)
    const mine = suggesting(sam)
    Transforms.insertText(mine.editor, 'Please ', { at: { path: [0, 0], offset: 0 } })
    await saved(sam)

    const by = (editor: Editor) => ((editor.children[0] as Element).children[0] as { _by?: string })._by
    await until(() => by(review.editor) === 'person:sam')
    await until(() => by(mine.editor) === 'person:sam')
  })

  it('suggests taking back an agent’s run, for a person to accept', async () => {
    await start()
    const alice = await open('alice', 's-9')
    const run = alice.claimOrigin({ agent: 'copy', run: 'r1' })
    alice.doc.transact(() => {
      const block = field(alice.doc).get(0) as Y.Node
      block.delete('Write '.length, '600 '.length)
      block.insert(0, 'Please ')
    }, run)
    await saved(alice)
    await until(() => !Y.createIdSetFromIdMap(alice.attributions().deletes).isEmpty())
    expect(content(alice)).toBe('Please Write words.')

    // Even with a view open that lets typing go into the text, a revert is only suggested
    const editing = suggesting(alice, { suggesting: false })
    expect(alice.suggestRevert({ run: 'r2' })).toBe(false)
    expect(alice.suggestRevert({ run: 'r1' })).toBe(true)
    expect(pieces(editing.editor).length).toBe(4)
    await saved(alice)
    expect(content(alice)).toBe('Please Write words.')

    const review = suggesting(alice)
    expect(pieces(review.editor)).toEqual([['Please ', 'delete'], ['Write ', ''], ['600 ', 'insert'], ['words.', '']])
    review.renderer.acceptAllChanges()
    await saved(alice)
    expect(content(alice)).toBe('Write 600 words.')
  })
})
