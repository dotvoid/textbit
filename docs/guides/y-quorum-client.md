# y-quorum, the client

`@dotvoid/y-quorum-client` connects a page, or a process in Node, to a
[y-quorum server](./y-quorum.md). One connection carries any number of documents: some open
in full, some only watched. The same document can be shown in several views of one page, all
editable, and the server sees one client. Textbit editors bind to a document's text fields.

```bash
npm install @dotvoid/y-quorum-client @dotvoid/textbit @y/y @y/protocols slate
```

The client exports the type functions too (`defineType`, `text`, `list` and so on, see
[Document types](./y-quorum.md#document-types)), so a module of types can be shared by server
and client without the server's code. `@dotvoid/y-quorum-client/model` holds the document
model alone, `@dotvoid/y-quorum-client/protocol` the wire protocol.

## Connecting

```ts
import { createClient } from '@dotvoid/y-quorum-client'

const client = createClient({
  url: 'wss://documents.example.com',
  // Asked again at every connection
  token: () => fetchToken()
})

client.on('status', (status) => showOffline(status !== 'connected'))
const { principal, namespaces, limits } = await client.ready
```

- **`ready`** resolves when the server has welcomed the client: who it takes the client to be,
  the namespaces it may enter and the limits of the connection. It rejects when the token is
  refused.
- **`status`** is `connecting`, `connected`, `disconnected` or `closed`. A lost connection is
  tried again by itself, after a short wait that grows to ten seconds. The client pings the
  server and gives up on a connection that has been silent for a minute, rather than wait for
  the browser to notice.
- **`closed`** is for good: after `client.close()`, or when the server refuses the token, finds
  the client's protocol too old (the page should reload), or sees another principal's token on
  the connection. Everything open is closed, with the reason.
- **Tokens.** `token` is a string or a function, asked at every connection. To renew a token
  on an open connection, without reconnecting, call `client.setToken(token)`. It must be for
  the same principal. The server asks for roles again: open documents may get new
  capabilities, or be closed when they may no longer be read.
- **`rpc(name, args)`** calls a function the host gave the server, and resolves with what it
  returns. A call on its way when the connection is lost is rejected with `unavailable`: it may
  or may not have been carried out, and only the app can tell whether to try again.

Errors from the client are `QuorumError`s, with a `code`: the server's reason code, such as
`not-allowed`, `not-found` or `over-limit`.

## Opening a document

```ts
import * as Y from '@y/y'
import { toJSON } from '@dotvoid/y-quorum-client'
import { plan } from './types'

const handle = await client.open('team-1', 'plan-1')

handle.content.getAttr('status') // 'draft'
handle.content.setAttr('status', 'ready')
const title = handle.content.getAttr('title') // a text field: a Y.Node
console.log(title instanceof Y.Node, toJSON(handle.content, plan.content))

handle.content.on('delta', () => render(toJSON(handle.content, plan.content)))
handle.on('capabilities', (capabilities) => console.log(capabilities.write))
handle.on('closed', ({ code, reason }) => console.warn(code, reason))
```

`open` resolves once the document is in step with the server. It rejects with `not-found` for
a document that does not exist or that the person may not see, and `not-allowed` where they
may see it but not read it.

- **`handle.content`** is the content's root `Y.Node`. Plain fields are its attributes, read
  with `getAttr` and set with `setAttr`; objects, lists and text fields are nodes held in
  attributes. `handle.doc` is the Y.Doc. `toJSON(node, schema)` gives the content as JSON.
- **`handle.capabilities`** is what this person may do here, as the server's policy decided:
  `read`, `write`, `records`, `comments`, `suggestions` and `versions`. When it changes, such
  as when someone publishes the document, `capabilities` is emitted.
- **`handle.type`** and **`handle.incarnation`**: the document's type, and which making of the
  document this is. A document wiped or made again has a new incarnation, and a client holding
  the old one starts again from the server rather than merge it in.
- **`closed`** is emitted when the server closes the document, such as when it is deleted
  (`gone`) or the person may no longer enter its namespace.

Lists are ordered by a position of their own, never moved. Add an item with all its fields
with `addItem`, read items in order with `itemsOf`, and move one by giving it a position
`between` two others:

```ts
import { addItem, between, itemsOf, POSITION, type ListField } from '@dotvoid/y-quorum-client'

const tasks = handle.content.getAttr('tasks')
const schema = plan.content.fields.tasks as ListField
if (tasks instanceof Y.Node) {
  addItem(tasks, schema, { id: 'photos', title: [], done: false })
  const items = itemsOf(tasks, schema)
  const first = items[0].getAttr(POSITION)
  items[items.length - 1].setAttr(POSITION, between(undefined, String(first)))
}
```

Never put a new, empty text field into an attribute of an existing node: text fields are
created with their parent, and two clients creating the same one at once would lose one's text.

## Watching and presence

A list of documents rarely needs them whole. **Watching** gives chosen fields as JSON, read
only, pushed when they change:

```ts
const rows = await Promise.all(['plan-1', 'plan-2', 'plan-3'].map(
  (id) => client.watch('team-1', id, ['status', 'meta.slug', 'title'])
))
rows.forEach((row, i) => {
  showRow(`plan-${i + 1}`, row.value)
  row.on('change', (value) => showRow(`plan-${i + 1}`, value))
})
```

Paths are dot paths; text fields come as textbit values. Open the document when someone starts
editing in the list.

**Presence** in a namespace says who has which documents open, and what they are doing:

```ts
const stop = client.presence('team-1', (entries) => showWhoIsHere(entries))
// [{ principal, namespace: 'team-1', id: 'plan-1', mode: 'editing', visible: true }]
```

A person with a document open is `reading` it until the app says otherwise:
`handle.setMode('editing')`, or `handle.setMode('reading', false)` when the page is hidden.
Watching does not count as presence.

Inside a document, `handle.awareness` carries cursors and selections, as with any Y.js
provider. The server stamps each state with the principal it belongs to, so nobody appears as
someone else.

## Many documents and many views

One connection holds as many documents as the server's limits allow (`limits.open` and
`limits.watch`, 500 and 2000 by default). Opening past them is refused with `over-limit`.

The same document opened twice in one page is opened once:

```ts
const row = await client.open('team-1', 'plan-1')
const editor = await client.open('team-1', 'plan-1')
row.doc === editor.doc // true: one Y.Doc, one opening
row.release()
editor.release() // closed after the grace period, once everything is stored
```

- **Every view binds to the same Y.Doc,** so each sees the others' changes at once, without a
  round trip. Each editor has its own origin, and so its own undo: undo in a list row does not
  undo typing in the full editor. Several editors on one text field are fine.
- **Each `open` gives a handle of its own,** with its own listeners, renderers and comments.
  Release each when its view goes.
- **A released document stays open for a grace period,** two seconds by default (`grace` in
  `createClient`), so a list that renders again does not close and reopen it. It is closed
  only once everything changed in it is stored.

## Text fields and editors

A text field is a `Y.Node` holding textbit's blocks. Give it to `Textbit.Root` as `value`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import * as Y from '@y/y'
import { Textbit } from '@dotvoid/textbit'
import { Text, Bold, Italic } from '@dotvoid/textbit-plugins'
import type { DocumentHandle } from '@dotvoid/y-quorum-client'

type Person = { name: string, color: string }

export const ArticleEditor = ({ handle, person }: { handle: DocumentHandle, person: Person }) => {
  const plugins = useMemo(() => [Text(), Bold(), Italic()], [])
  // After a refusal the content is another Y.Doc: bind to the new one
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const rebuilt = ({ layer }: { layer: string }) => {
      if (layer === 'content') {
        setGeneration((n) => n + 1)
      }
    }
    handle.on('rebuilt', rebuilt)
    return () => handle.off('rebuilt', rebuilt)
  }, [handle])

  const body = handle.content.getAttr('body')
  if (!(body instanceof Y.Node)) {
    return null
  }
  return (
    <Textbit.Root
      key={generation}
      value={body}
      awareness={handle.awareness}
      cursor={{ data: person }}
      plugins={plugins}
      comments={handle.comments.field(['body'])}
      readOnly={!handle.capabilities.write}
    >
      <Textbit.Editable aria-label='Article' onFocus={() => handle.setMode('editing')} />
    </Textbit.Root>
  )
}
```

- **Use the plugins the field's type names.** `text({ plugins: 'singleLine' })` is a name your
  app maps to plugins: every editor of a field should have the same ones.
- **Loading never writes.** A shared editor does not repair or give ids to what it loads, only
  to what the person does, so reading a document never makes anyone its author.
- **Without React,** bind a headless editor. A text field inside a list item is found by path,
  the item named by its key:

```ts
import * as Y from '@y/y'
import { Transforms } from 'slate'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Italic } from '@dotvoid/textbit-plugins/definitions'
import { resolvePath } from '@dotvoid/y-quorum-client'

const plugins = [Text(), Bold(), Italic()]
const notes = resolvePath(handle.content, plan.content, ['tasks', '#check', 'notes'])?.value
if (notes instanceof Y.Node) {
  const editor = createTextbitEditor({ plugins, shared: notes })
  Transforms.insertText(editor, 'Ask the harbour master. ', { at: { path: [0, 0], offset: 0 } })
}
```

`sharedOf(editor)?.release()` unbinds it. See [Without a user interface](./headless.md).

## Records and messages

```ts
handle.appendRecord('status.changed', { from: 'draft', to: 'ready' })
showLog(handle.records) // [{ seq, kind, at, actor, onBehalfOf, data }]
handle.on('records', (added) => showLog(added))
handle.on('message', (message) => console.log('from the host', message))
```

`appendRecord` asks the server, which checks the kind against `capabilities.records`, stamps
the actor and time, and sends the record to everyone with the document open, the sender too.
A refused record is emitted as `rejected`, with `record` set. A record sent again after a
lost acknowledgement carries the id it was first sent with, and the server stores it once.
`message` is what the host sends with `server.send`.

## Comments

For a type with comments, `handle.comments` reads and writes the threads:

```ts
const stop = handle.comments.subscribe((threads) => show(threads))
handle.comments.rights // 'none', 'own' or 'all'
const thread = handle.comments.threads[0]
if (thread) {
  handle.comments.reply(thread.id, 'Agreed.')
  handle.comments.resolve(thread.id)
}
stop()
```

`create(anchor, body)`, `reply`, `edit`, `remove` and `resolve` write in the name of whoever is
logged in; the server holds them to their rights. `handle.comments.field(path)` is the comments
of one text field, for its editor: give it to `Textbit.Root` as `comments`, and the editor
anchors new threads in the selection and highlights what is commented on. See
[Comments](./the-editor.md#comments).

## Suggestions

For a type with suggestions, `handle.suggestionsDoc` is the fork of the content they are made
in, and `handle.suggestionsRenderer()` shows the difference between the two, with who suggested
what. Bind the editor to the fork's field through it:

```tsx
import type * as Y from '@y/y'

type Props = { handle: DocumentHandle, suggesting: boolean }

export const SuggestingEditor = ({ handle, suggesting }: Props) => {
  const plugins = useMemo(() => [Text(), Bold(), Italic()], [])
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const rebuilt = ({ layer }: { layer: string }) => {
      if (layer !== 'comments') {
        setGeneration((n) => n + 1)
      }
    }
    handle.on('rebuilt', rebuilt)
    return () => handle.off('rebuilt', rebuilt)
  }, [handle])
  // Made in an effect and destroyed in its cleanup: one left alive keeps
  // passing typing in the fork on to the text
  const [shown, setShown] = useState<{ generation: number, renderer: Y.DiffRenderer }>()
  useEffect(() => {
    const made = handle.suggestionsRenderer({ suggesting: false })
    setShown({ generation, renderer: made })
    return () => made.destroy()
  }, [handle, generation])
  const renderer = shown?.generation === generation ? shown.renderer : undefined
  useEffect(() => {
    if (renderer) {
      renderer.suggestionMode = suggesting
    }
  }, [renderer, suggesting])

  const body = handle.suggestionsDoc.get('content').getAttr('body')
  if (!renderer || !(body instanceof Y.Node)) {
    return null
  }
  return (
    <Textbit.Root
      key={generation}
      value={body}
      renderer={renderer}
      awareness={handle.awareness}
      plugins={plugins}
    >
      <Textbit.Editable aria-label='Article' />
      <Textbit.Suggestions aria-label='Suggestions' people={handle.people} />
    </Textbit.Root>
  )
}
```

- **`suggesting`** (`renderer.suggestionMode`) decides where typing goes: into the fork, as a
  suggestion, or into the text, with others' suggestions shown around it. It may change at any
  time. `suggestionsRenderer({ origins })` limits what goes into the text to the transactions
  of the origins given, for several editors on one fork.
- **Accepting and rejecting** is `Textbit.Suggestions`, or `useSuggestions()` for a list of
  your own. Accepting takes `suggestions: 'all'`; withdrawing one's own takes `own`. The server
  checks both. See [Suggestions](./suggestions.md).
- **Destroy a renderer** when its view goes. When the content or the fork is rebuilt after a
  refusal, the client destroys the renderers bound to them: make a new one on `rebuilt`.

**Taking back an agent's work.** For a type with history and suggestions,
`handle.suggestRevert({ run, by, since })` puts the inverse of what a run, an actor (by key) or
a stretch of time changed into the fork, for a person to accept or reject. Nothing in the text
changes until someone accepts. It returns whether the fork changed: `false` when there was
nothing to take back, or it is suggested already.

```ts
handle.suggestRevert({ run: 'r1' })
handle.suggestRevert({ by: 'agent:copy', since: Date.now() - 60 * 60 * 1000 })
```

## Who wrote what

For a type with history, the server tells the client who wrote and deleted each piece of
content. `handle.attributionsRenderer()` shows it: give it to `Textbit.Root` as `renderer`, with
the content's field as `value`, and each piece of text carries `_by` and `_at`, its leaf
`data-tb-by`. With `{ withDeleted: true }` deleted text shows too.

```ts
const renderer = handle.attributionsRenderer() // to Textbit.Root as renderer
handle.people // { 'person:alice': { kind: 'person', id: 'alice', name: 'Alice' }, … }
handle.on('attributions', ({ layer }) => console.log('attributed', layer))
renderer.destroy()
```

`handle.people` names the keys the attributions use, for showing who; `handle.attributions()`
is the raw Y.js content map of a layer.

**Review evidence.** What agents wrote and no person has reviewed is listed by
`handle.unreviewed()`, by agent, person and run. A person who may edit marks it reviewed with
`handle.review(run)`, one run's, or without a run, all of it as it is now. It is an act of its
own in the history.

```ts
const open = await handle.unreviewed() // [{ agent, onBehalfOf, run, length }]
if (open.length) {
  await handle.review('r1')
}
```

## Versions and comparing

For a type with history:

```ts
const log = await handle.save('Sent for review')
const latest = handle.versions[handle.versions.length - 1] // { id, seq, at, by, label, kind }
handle.on('versions', (made) => console.log(made.map((version) => version.label)))

// The content at a version, or at any log position, read only
const then = await handle.version(latest.id)
const earlier = await handle.version(Math.max(0, log - 50))

// What changed since a version, and who changed it
const { content, renderer } = await handle.compare(latest.id)
show(content.getAttr('body'), renderer)

if (handle.capabilities.versions === 'restore') {
  await handle.restore(latest.id)
}
```

- **`save(label)`** makes a version holding everything this client has, and resolves with its
  log position. It takes `versions: 'create'`.
- **`versions`** are the document's versions, oldest first: `created`, `saved`, or
  `before-restore`, the one the server makes before every restore.
- **`version(at)`** is the content at a version, by its id, or at a log position, as a Y.Doc
  of its own: to show, never to edit. `handle.log` is the latest log position the client
  knows, so a slider can go from 0 to it.
- **`compare(from, to?)`** is the difference between a version or log position and a later
  one, or the content as it is now: show the `content`'s fields through `renderer`, read only.
  Both sides are copies, so it holds still while others type.
- **`restore(id)`** brings a version back as a new change in this person's name. It takes
  `versions: 'restore'`.

## Saving

Changes are sent as they are made, and stored by the server as they arrive. There is nothing to
save for them to reach others. What the client tracks:

```ts
handle.on('saved', ({ log }) => console.log('stored up to', log))
window.addEventListener('beforeunload', (event) => {
  if (handle.hasUnsavedChanges) {
    event.preventDefault()
  }
})
```

- **`hasUnsavedChanges`** is whether some change has not been acknowledged yet. `saved` is
  emitted when everything is.
- **Offline,** changes are kept and sent when the connection is back, in one update.
- **`save()`** is for a moment that must hold everything the person has, before publishing for
  instance: it resolves once the server holds all of it. For a type with history it makes a
  version and takes `versions: 'create'`; without, it calls the host's `onSave` and takes
  `write`.

## Rejections and rebuilds

The server refuses a change the person may not make: a reader typing, a write to a document
that became read-only while they were offline, a comment in someone else's name. The client
then gets the refused changes back, and starts that layer again from the server's state.

```ts
handle.on('rejected', ({ code, reason, updates, record }) => {
  if (record) {
    tell(`Could not record ${record.kind}: ${reason}`)
  } else {
    // The refused changes, and every change of the layer after them
    keepForLater(updates)
    tell(code === 'not-allowed' ? 'The document is read-only now' : reason)
  }
})
handle.on('rebuilt', ({ layer }) => {
  // 'content': bind editors and presence to handle.doc and handle.awareness again;
  // 'suggestions': make a new suggestionsRenderer; 'comments': nothing to do
  console.log(layer)
})
```

- **Why a rebuild.** Once a change is refused, every later change of the same Y.js client
  depends on it and could never be stored. So the client starts the refused layer again under a
  new client id, and opens the document again. The other layers' changes stand.
- **`rejected`** comes first, with the reason code and `updates`: the refused Y.js update and
  every unacknowledged one of that layer after it, for the app to keep, show, or offer again.
  For a refused record, `updates` is empty and `record` says which.
- **`rebuilt`** follows once the layer is in step again, with its new Y.Doc. For the content,
  `handle.doc`, `handle.content` and `handle.awareness` are new: bind editors to them again,
  such as with a `key`, as in the examples above. For the fork, the old renderer is destroyed.
  `handle.comments` follows by itself.
- **A replaced document** (a new incarnation, after a wipe or reseed) is rebuilt the same way,
  with `gone`, and any changes the client still held handed back.

> **Not yet:** the refused changes as JSON, what they would have changed; today they are Y.js
> updates, which apply only to the content they were made in.

## Agents working through a person's connection

An agent in the person's page, or one running beside it, can work through the person's
connection. Its changes are then recorded as the agent's, for the person, with the run and model
it gives:

```ts
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { createDocumentAgent, createAgentTools } from '@dotvoid/textbit-agent'

// The plugins of the person's editors, without their views
const plugins = [Text(), Bold(), Italic()]
const claim = { agent: 'copy', name: 'Copy editor', run: crypto.randomUUID() }
const origin = handle.claimOrigin(claim)

const body = handle.content.getAttr('body')
if (body instanceof Y.Node) {
  // Everything this editor writes is sent as the agent's, for the person
  const editor = createTextbitEditor({ plugins, shared: body, origin })
  const tools = createAgentTools(createDocumentAgent(editor, { plugins }))
}
handle.comments.reply(threadId, 'Fixed the dates.', claim)
handle.appendRecord('status.changed', { to: 'ready' }, claim)
```

- **`claimOrigin(claim)`** gives an origin. Every transaction made with it is sent in frames of
  its own, carrying the claim, so the agent's changes are never mixed with the person's. An
  editor of the person's can make some changes as the agent with
  `sharedOf(editor)?.withOrigin(origin, change)`.
- **The claim** is `agent` (an id), and optionally `name`, `run` and `model`. The server takes
  the claim only where the person's token allows agents, and gives the agent no more than the
  person's roles; the policy can narrow them further.
- **Comments and records** take the claim as their last argument.
- To suggest rather than edit, give the agent an editor bound to the fork's field, as in
  [Suggestions](./suggestions.md#from-an-agent).

An agent with a connection and a token of its own is simply a client whose principal is an
agent. To let agents in over MCP, see
[Agents over MCP](./agents-mcp.md#agents-at-a-y-quorum-server).

## From Node

The client works the same in Node 22 or later, which has `WebSocket` built in. A service writing to
documents connects with a token for a `service` principal and binds headless editors to the
fields it edits, as above.

## Limits

- **Unsent changes live in memory.** A page closed before they are acknowledged loses them;
  `hasUnsavedChanges` says when that would happen.
- **Opening past the connection's limit is refused.** The client does not yet demote hidden or
  least recently used documents to watching to make room.
- **One fork per document:** everyone's suggestions are in one set.
- **Deciding a suggestion is not in the person's undo.** To go back on a decision, suggest the
  change again.

> **Not yet:** local copies of documents and their unsent changes in IndexedDB, kept per
> person so that nothing typed under one login is ever sent under another. Demoting documents
> from open to watching within the connection's budget.

## Next

- [y-quorum, the server](./y-quorum.md)
- [Suggestions](./suggestions.md)
- [The editor](./the-editor.md) and [Without a user interface](./headless.md)
- [Agents](./agents.md)
