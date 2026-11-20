# y-quorum, the server

y-quorum is a collaboration server for documents that people and agents write together. It
holds each document in memory, takes everyone's changes over WebSockets, and passes them on, as
any Y.js server does. What it adds is the reason it exists:

- **Typed documents.** A document is a tree of fields its type describes: rich text fields,
  plain values, objects and keyed lists. Comments, suggestions, records and history live beside
  the content, never in it.
- **Rules the server enforces.** Every change is judged before it is stored: by your policy for
  the content, by who wrote what for comments and suggestions. A document that becomes
  read-only is read-only for everyone at once. An agent can do no more than the person it acts
  for.
- **An accountable history.** Every change has an actor, decided by the server and never taken
  from what a client says about itself: the person, or the agent and the person it acted for.
  The history is a hash chain that can be exported, checked and signed.

`@dotvoid/y-quorum` is the server, for Node 22 or later. Its client is
`@dotvoid/y-quorum-client`, for the browser and for Node; see
[y-quorum, the client](./y-quorum-client.md). Both are built on Y.js 14 (`@y/y`).

```bash
npm install @dotvoid/y-quorum @dotvoid/textbit @y/y @y/protocols slate
```

## Starting a server

```ts
import { createServer, defineType, object, oneOf, sqlite, text } from '@dotvoid/y-quorum'

const article = defineType('example/article', {
  content: object({
    title: text({ plugins: 'singleLine' }),
    body: text(),
    status: oneOf(['draft', 'published'])
  }),
  comments: true,
  suggestions: true,
  history: true
})

const server = createServer({
  types: [article],
  storage: sqlite('documents.sqlite'),
  // Who a token belongs to, and which namespaces they may enter
  authenticate: async (token) => {
    const user = await verifyToken(token)
    return user && {
      principal: { kind: 'person', id: user.id, name: user.name },
      namespaces: [user.team]
    }
  },
  // Their roles on one document; nothing when they may not see it
  authorize: ({ principal, namespace, id }) => rolesOf(principal.id, namespace, id)
})

await server.listen(1234)
```

`verifyToken` and `rolesOf` are yours: y-quorum has no users of its own.

- **`listen(port)`** starts an HTTP server of its own and resolves with it. To share a server
  you already have, `attach` it instead: y-quorum then serves its WebSocket upgrades.

  ```ts
  import { createServer as createHttpServer } from 'node:http'

  const http = createHttpServer(app)
  server.attach(http, { path: '/collab' })
  http.listen(8080)
  ```

  With `path`, it takes only upgrades to that path and leaves the others to the server's other
  listeners; without, it takes every upgrade. Clients then connect to
  `wss://example.com/collab`. TLS is the HTTP server's, or a proxy's in front of it.
- **`authenticate(token, request)`** is asked once per connection, with the token the client
  sends first and the HTTP request it came with. It returns the **principal** (`kind` is
  `'person'`, `'agent'` or `'service'`, with an `id` and a `name`; anything else you add, such
  as a colour, travels with it), the namespaces they may enter (or `'*'`), and whether agents
  may work through this connection (`agents`, `true` by default for people). Nothing refuses
  the connection.
- **`authorize({ principal, namespace, id, type })`** gives the principal's roles on one
  document, such as `['editor']`. Nothing, or `null`, means they may not see it: the client is
  told it does not exist. Without `authorize`, everyone is an editor everywhere they may enter.
- **Namespaces** are boundaries. Ids are unique within one, and nothing crosses from one to
  another: leases, presence and deletion work per namespace. A host with customers gives each
  their own; one without may still use several.

A token can be renewed on an open connection (see the client guide). The renewed token must
belong to the same principal, or the connection is closed; its namespaces may change, and
documents in a namespace no longer allowed are closed. `authorize` is asked again for every
document the connection has open: clients are told their new capabilities, and documents they
may no longer read are closed. Connections relayed to other nodes renew with it.

The other options:

| Option | Default | |
|---|---|---|
| `rpc` | | Functions clients call by name, see [Code in the server process](#code-in-the-server-process) |
| `onSave` | | Called when a client saves, see [Versions](#versions-and-restoring) |
| `limits` | `{ open: 500, watch: 2000, frame: 4 MiB }` | Documents one connection may open and watch, and the largest frame in bytes. Clients are told them when they connect. |
| `idle` | `5000` | Milliseconds a document stays loaded after the last connection leaves |
| `plugins` | | The plugins of text fields, by the name each gives in `text({ plugins })`, `default` for none: what [repairs](#repairs) and checks go by |
| `repairAfter` | `100` | Milliseconds after a person's write before what it broke is repaired |
| `settleAfter` | `2000` | Milliseconds after the last change before a storage that keeps JSON is given an open document, see [Hosts that store JSON](#hosts-that-store-json) |
| `checkpointEvery` | `200` | Log entries between checkpoints |
| `signer` | | Signs the history, see [Signing](#signing) |
| `node`, `nodeSecret`, `leaseTtl` | | More than one node, see [More than one node](#more-than-one-node) |

## Document types

A type describes a document's content, one tree of fields, and the layers beside it. Server
and client read the same definition, so define types in a module both import.

```ts
import {
  boolean, date, defineType, id, list, number, object, oneOf, string, text
} from '@dotvoid/y-quorum'

const task = object({
  id: id(),
  title: text({ plugins: 'singleLine' }),
  done: boolean(),
  notes: text()
})

export const plan = defineType('example/plan', {
  content: object({
    title: text({ plugins: 'singleLine' }),
    status: oneOf(['draft', 'ready', 'published']),
    due: date({ optional: true }),
    meta: object({ slug: string(), words: number({ optional: true }) }),
    tasks: list(task, { key: 'id' })
  }),
  records: { 'status.changed': { description: 'The plan moved on' } },
  comments: true,
  suggestions: true,
  history: true
})
```

The client exports the same functions from `@dotvoid/y-quorum-client`.

- **Plain values:** `string()`, `number()`, `boolean()`, `date()`, `id()` and
  `oneOf([...])`, each `optional` or not. A plain value is held as a Y.js attribute: two people
  setting it at once end with one value, the same on every client.
- **`text()`** is one textbit body, anywhere in the tree, inside list items too.
  `text({ plugins: 'singleLine' })` names the plugin configuration editors use for it. The
  name is yours: the server keeps it, the MCP module looks it up in the plugins it is given,
  and your app chooses plugins by it.
- **`object({...})`** groups fields.
- **`list(item, { key })`** is a list of objects, each with a key field unique in the list.
  Items are ordered by a position of their own, never moved: reordering changes only the
  position, so the text in an item keeps its identity, and the comments and suggestions
  anchored in it stay. Paths name an item by its key, such as `['tasks', '#check', 'notes']`.
- **Text fields are created with their parent.** `server.create` makes every field of the
  type, empty where no value is given, and a list item is added with all its fields. Two
  clients creating the same text field at once would lose one's text, so neither ever does.
- **`comments`, `suggestions`, `history`** and **`records`** are each opted into per type. A
  type for tags or preferences needs none of them.

Create a document from code, filled from JSON: text fields as textbit values, lists as arrays
in order.

```ts
await server.create('team-1', 'article-1', 'example/article', {
  title: [{ id: 't1', type: 'base/text', class: 'text', children: [{ text: 'The harbour' }] }],
  status: 'draft'
})
```

It fails when the document exists. The type is stored with the document, and loading looks
its definition up by that name: a server must have the type of every document it serves. An
optional fifth argument, an actor, is who made it; otherwise the system.

## Roles, capabilities and policies

Roles are yours: `authorize` returns them. The server turns them into **capabilities**, what
a connection may do in a document, and sends them to the client:

| Capability | Values |
|---|---|
| `read`, `write` | Whether the content may be read and changed |
| `records` | The record kinds that may be appended |
| `comments` | `none`; `own`, open threads, reply, and edit, delete and resolve one's own; `all`, also resolve and delete anyone's |
| `suggestions` | `none`, only see them; `own`, suggest, and edit and withdraw one's own; `all`, also accept and reject anyone's |
| `versions` | For a type with history: `read`; `create`, also save versions; `restore`, also restore them |

Without a policy, the roles mean:

| Role | Content | Comments | Suggestions | Versions |
|---|---|---|---|---|
| any role, e.g. `reader` | read | none | none | read |
| `commenter` | read | own | none | read |
| `suggester` | read | own | own | read |
| `editor` | write, every record kind | all | all | create |
| `owner` | write, every record kind | all | all | restore |

### The policy

A type's policy decides with what the document holds. It is a pure, synchronous function from
a context to capabilities:

```ts
import type { ServerType } from '@dotvoid/y-quorum'

export const planType: ServerType = {
  ...plan,
  policy: ({ actor, roles, content, next, paths }) => {
    const editor = roles.includes('editor') || roles.includes('owner')
    // Judged on the content before the write: the write that publishes is allowed
    const published = content.getAttr('status') === 'published'
    // Only an owner publishes
    const publishing = !published && next?.getAttr('status') === 'published'
    // Agents change the tasks, nothing else
    const agent = actor.principal.kind === 'agent'
    const tasksOnly = (paths ?? []).every((path) => path[0] === 'tasks')
    const owner = roles.includes('owner')
    return {
      read: roles.length > 0,
      write: editor && !published && (!publishing || owner) && (!agent || tasksOnly),
      records: editor ? ['status.changed'] : []
    }
  }
}
```

Give the server `planType` rather than `plan`. `defineType` makes the definition client and
server share; the policy is the server's alone.

- **`actor`** is who acts: `principal`, and for an agent working through a person's connection,
  `onBehalfOf`, `run` and `model` (as the agent claims it, never verified). Every question
  about an agent's rights carries it, comments and suggestions too. When the server asks what
  a connection may do in general, `actor` is the connection's principal alone.
- **`roles`** are the principal's, from `authorize`. For an agent working for a person, the
  person's.
- **`content`** is the document as it is: the root `Y.Node`, plain values read with
  `getAttr`.
- **`next`**, for a write, is the content as it would be after it. A rule such as "published
  documents are read-only" must judge `content`, or it would refuse the very write that
  publishes; a rule about the result, such as who may publish, judges `next`.
- **`paths`** are the paths the write changes, such as `['meta', 'slug']` or
  `['tasks', '#check', 'notes']`. Inside a text field the path ends at the field. Without
  `paths` (and `next`) the server is asking what the connection may do in general, which is
  what the client is told.

The server asks the policy for every write to the content, with its paths, and only `write` in
the answer counts. **Whenever the content changes, it asks again for every open connection**,
and tells each client whose capabilities changed, from that log position on. A document that
becomes published is read-only for everyone at once, without your code calling anything.
`comments`, `suggestions` and `versions` follow the roles, as in the table, unless the policy
returns them, but `all` goes with `write`: on a document that became read-only, editors no
longer comment or decide suggestions, while commenters and suggesters keep `own`. A policy that
wants editors commenting on published documents returns `comments: 'all'` for them.

A write that touches a field the policy refuses is refused whole. That is why the client sends
each editor's changes in frames of their own.

### Agents' rights

An agent reaches a document in one of two ways:

- **With a connection of its own,** authenticated as a principal of kind `'agent'`.
  `authorize` gives it roles like anyone.
- **Through a person's connection,** its changes claimed as its own: an agent in the person's
  page, or the MCP module, which keeps a connection per person and agent. Its rights are the
  person's roles, which the policy can narrow by `actor.principal.kind`, as above. The history
  records the agent, for the person. `agents: false` from `authenticate` refuses every claim on
  that connection.

Reviewing what agents wrote (see [Review evidence](#review-evidence)) is a person's act: an
agent can never do it.

## What the write pipeline guarantees

Each document is held by one owner, which handles its writes one at a time, in order.

- **Every change has an actor.** The connection's principal, or an agent claiming to act for
  it where the connection allows agents. Awareness is stamped by the server too: nobody appears
  to others as someone else.
- **Client ids are owned.** New content is accepted only under Y.js client ids the writer
  holds. A client names its id when it opens a document; one that may write claims it then,
  and one that may only read has it checked. Ids are claimed by writes once they are accepted.
  An id another principal holds is refused, so nobody writes under someone else's.
- **Each layer is judged by its own rules.** A change to the content is judged by the policy on
  the paths it changes, a change to the comments by who wrote what, a change to the suggestions
  by the suggestion rights. A change reaching outside its layer is refused.
- **Updates that arrive early are held.** An update that depends on one not here yet waits
  until it can be applied, up to 64 updates or 4 MiB per opening, after which they are refused
  with `conflict`.
- **Refused writes are handed back.** The client is told why, with a reason code, and gets the
  refused update back. It starts that layer again from the server's state under a new client
  id, because every later change of the old one would depend on what the server will never
  have, and hands the refused changes to the app.
- **Accepted writes** are appended to the log, applied, acknowledged with their log position
  and passed on to everyone with the document open; for a type with history, who wrote them is
  sent first, so views can name the author as the change arrives.
- **An update that changes nothing,** such as the deletions a reopening client sends again, is
  acknowledged and not stored.

Reason codes are fixed strings in a fixed place, never message text: `not-allowed`,
`not-found`, `gone`, `over-limit`, `invalid`, `conflict`, `client-id-taken`, `unavailable`,
`unauthenticated` and `stale-protocol`.

### Repairs

Two people's changes can each be valid and still merge into a shape neither made: a block both
moved at once is there twice, as Y.js moves by copying; a list one person numbered while the
other added a bullet item holds both kinds; two people add the list item `check` at once. No
single write shows it, so refusing writes cannot prevent it. The server repairs instead, a
moment after (`repairAfter`, 100 ms by default), and only the server: two clients repairing the
same thing at once would duplicate or delete it.

- **Text fields** that people's writes touched are repaired by textbit's rules with
  `repairField` (see [Without a user interface](./headless.md#repairing-a-shared-document)),
  with the plugins the field names. Give the server the plugins your editors have, by the name
  each text field gives:

  ```ts
  import { Text, Bold, UnorderedList } from '@dotvoid/textbit-plugins/definitions'

  createServer({ types: [planType], storage, authenticate, plugins: {
    default: [Text(), Bold(), UnorderedList()],
    singleLine: [Text()]
  } })
  ```

  Without `plugins`, core's rules alone apply, and objects of plugins the server does not have
  are left as they are.
- **Plain values** of the wrong kind, such as a `oneOf` value the type does not list, go back to
  what they were before the write. A field that is not what the type says is written back from
  what it held.
- **List items** with a key an earlier item has are removed, the first by position staying; so
  is an item without its key.

A repair is one change of the server's own, by `REPAIRER` (`service:y-quorum`), sent to
everyone like any other and in the history as its own entry, kind `repair`. Nobody is made the
author of a repair, and it is not counted as anyone's work to review. A field that keeps
needing repairs, from plugins whose rules never settle, is left alone after 20 repairs in a
minute.

**Agents and code are checked first instead.** A write by an agent, or by code in the server
process (`transact`), that adds a problem is refused with `invalid` before it applies: a value
the type does not allow, or an error by the plugins' rules in a text field it changed that the
field did not have before. They are told why and can try again; a person's typing is never
thrown away for its shape.

## Comments and suggestions

Comments and suggestions are layers beside the content, each a Y.Doc of its own.

**Comments** are threads anchored in a text field, by relative positions and by a quote in its
block. The server reads each change as threads before and after, whatever its bytes, and holds
everyone to their `comments` rights: a thread is opened and a comment written in one's own
name; nobody edits someone else's words; resolving or deleting anyone's takes `all`. A deleted
comment stays in its thread, emptied. `server.comments(namespace, id)` gives the threads,
oldest first.

**Suggestions** are a fork of the content, as Y.js 14 makes them: the content flows into it,
and what is suggested stays there until accepted. The server keeps the fork too and judges it:

- **Suggesting** takes `own` or `all`. The policy is not asked: a suggestion changes nothing
  until it is accepted, and accepting is judged by the policy.
- **Withdrawing** a suggestion, deleting what exists only in the fork, is its author's or an
  editor's to do.
- **Accepting** writes the suggester's own items into the content. It takes `all`, and the
  policy must allow the write. Items that claim to come from the fork but differ from it are
  refused.
- **Rejecting** writes them into the content already deleted, changing nothing anyone sees. It
  is the suggester's, or anyone's with `all`.

Accepts and rejections are history entries of their own, naming who suggested what was
decided. How people review suggestions in the editor is in [Suggestions](./suggestions.md),
and the client's side in [the client guide](./y-quorum-client.md#suggestions).

> **Not yet:** comment events for hosts (webhooks) and mentions. Accepting one person's change
> can take a neighbouring person's along, as Y.js decides a whole contiguous run at once. There
> is one fork per document, not one per person.

## History

For a type with `history: true` the server keeps three things beside the log.

**Attributions** say who wrote and who deleted each piece of content, and when: Y.js 14's
content maps, one per layer, built by the server from the writes it accepts. They name actors
by key, `kind:id` such as `person:alice` or `agent:copy`, with the person an agent acted for
and its run. Clients get them with the document and with every change, and show them through
a renderer; see the client guide.

**The history** is a chain of entries. The owner folds the log's writes into entries, one
actor, connection, layer and run at a time, at most ten seconds each and cut at versions.
Accepts, rejections, restores, reviews, records and signatures are entries of their own. Each
entry's hash covers its fields, a hash of its change and the hash of the entry before, so
nothing in it can be changed, removed or reordered without breaking the chain.

**The register of people** holds who the keys are. The chain names actors by key only,
`person:alice`, never by name; names live in each document's register, kept apart from it, so
the host can look after them as it decides. `server.people(namespace, id)` gives the register:

```ts
const people = await server.people('team-1', 'plan-1')
// { 'person:alice': { kind: 'person', id: 'alice', name: 'Alice' }, 'agent:copy': … }
```

### Exporting and checking

`server.exportHistory(namespace, id)` gives the history as JSON Lines, one entry per line.
`verifyHistory` checks such an export with nothing but itself: every payload against its hash,
every entry against its hash and the one before, and that together the entries cover the log
without a gap. An entry whose payload was removed by retention is checked by the hash it kept.

```ts
import { verifyHistory } from '@dotvoid/y-quorum'

const lines = await server.exportHistory('team-1', 'plan-1')
const verdict = verifyHistory(lines)
if (!verdict.ok) {
  console.error(`Entry ${verdict.seq}: ${verdict.reason}`)
}
```

An entry has `doc`, `seq`, the log positions it folds (`from`, `to`), `layer`, `at` and
`until`, `actor` (`by`, `onBehalfOf`, `run`, `model`, all keys or plain values), `connection`,
`kind` (`edit`, `accept`, `reject`, `restore`, `repair`, `review`, `record` or `signature`), `refs`
(such as the version a restore restored), the `payload` (the Y.js update, base64),
`payloadHash`, `prevHash` and `hash`.

### Signing

A hash chain shows that nothing was changed, unless whoever changed it rebuilt the whole chain.
With a signer, the server signs the history's head into the chain at every checkpoint and
version, so rewriting history takes the key, not only access to the store.

```ts
import { generateKeyPairSync, sign } from 'node:crypto'
import { createServer, memory, verifyHistory } from '@dotvoid/y-quorum'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

const server = createServer({
  types: [planType],
  storage: memory(),
  authenticate,
  signer: { keyId: 'history-2026', sign: (message) => sign(null, message, privateKey) }
})

const lines = await server.exportHistory('team-1', 'plan-1')
const verdict = verifyHistory(lines, { keys: { 'history-2026': publicKey } })
```

Keep the private key out of the store: in a key service, or at least another secret. Given
`keys`, `verifyHistory` checks every signature, and fails on one made with a key it was not
given.

### Versions and restoring

A version is the content at a log position. A document with history starts with one,
`Created`. A client saves one with `handle.save(label)`, which takes `versions: 'create'`:
the server waits until it holds everything that client had, then cuts the version at that
position, so a version never misses what the person had just typed. Saving again without a
change and without a label makes no new version.

`onSave` is called for every save, with the content as JSON at that position and the version
it made. That is the place to store or publish a copy of your own:

```ts
const server = createServer({
  types: [planType],
  storage: memory(),
  authenticate,
  rpc: {
    // A client calls it with client.rpc('publish', { namespace, id })
    publish: async (args, { principal, server }) => {
      const { namespace, id } = args as { namespace: string, id: string }
      return server.transact(namespace, id, { principal }, (content) => {
        content.setAttr('status', 'published')
      })
    }
  },
  onSave: async ({ namespace, id, json, version }) => {
    await publishCopy(namespace, id, json, version?.label)
  }
})
```

For a type without history, a save makes no version and takes `write`: it waits until the
server has everything the client had, then calls `onSave`.

**Restoring** a version, which takes `versions: 'restore'`, is a new change in the restorer's
name, never a rewrite: what was inserted since is deleted and what was deleted since comes
back. The server first makes a version of the content as it was, `before-restore`, so a
restore can be undone by restoring that. The policy must allow the write.

**Time travel:** a client can ask for the content at any version or log position (see the
client guide). The server replays the log from the latest version before it, and keeps the
last few states asked for, so scrubbing back and forth replays nothing twice.

### Review evidence

What agents wrote is marked in the attributions. A person who may edit can mark it reviewed,
one run's or all of it as it is now, with `handle.review(run)` in the client. A review is an
explicit act in the history, never inferred from reading or editing nearby, and it does not
cover what agents write after it.

`server.unreviewed(namespace, id)` lists the text agents wrote that is still there and no person
has reviewed, by agent, person and run, oldest first. It is meant for a publishing gate:

```ts
const open = await server.unreviewed('team-1', 'plan-1')
if (open?.length) {
  // e.g. [{ agent: 'agent:copy', onBehalfOf: 'person:alice', run: 'r1', length: 212 }]
  blockPublishing(open)
}
```

> **Not yet:** reviewing a range rather than a run; an export as W3C PROV; scrubbing the
> comments in step with the content; filtering differences by person or run; erasing content
> from the history as a recorded redaction.

## Records

Records are what happened to a document, appended and never edited: status changes,
acknowledgements, an agent's use. They are not a CRDT: a client asks, the server checks and
appends, and everyone with the document open gets them. The type names the kinds it keeps, and
the policy's `records` says who may append which (without a policy, editors and owners may
append every kind). The server stamps each with its actor and time, and for a type with history
puts it in the chain.

```ts
await server.appendRecord('team-1', 'plan-1', importer, 'status.changed', { to: 'ready' })
```

A record from code is checked as a client's is: `authorize` gives the actor's roles (or those
of whom it acts for), the policy's `records` must allow the kind, and the type must keep it.
Otherwise `appendRecord` throws.

## Storage

A storage keeps each document's log, checkpoints, records, versions, history, register of
people and client id claims.

```ts
import { Pool } from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { memory, postgres, s3, sqlite } from '@dotvoid/y-quorum'

const inMemory = memory()
const oneFile = sqlite('documents.sqlite')
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const shared = postgres(pool, { schema: 'y_quorum' })
const embedded = postgres(new PGlite('./documents'))
const withBlobs = s3(postgres(pool), bucket, { prefix: 'documents' })
```

- **`memory()`:** for tests and trying things out; gone when the process ends.
- **`sqlite(file)`:** one file, through Node's built-in `node:sqlite` (Node 22.13 or later).
  The default for one process; no other software needed.
- **`postgres(client, { schema })`:** node-postgres's `Pool` or PGlite, or anything with the
  same `query(text, params)`. Tables are made in `schema` (`y_quorum` by default) on first use.
  You own the client: the adapter never closes it, so several servers may share one.
- **`s3(inner, bucket, { prefix, inline })`:** keeps the large blobs (checkpoint states, version
  states, attribution maps from `inline` bytes, 16 KiB by default) in object storage, and
  everything else in `inner`. `bucket` is three functions, `put`, `get` and `delete` by prefix;
  the adapter's source shows them written for `@aws-sdk/client-s3`, which works for S3 and for
  stores that speak its protocol.
- **Your own:** the `Storage` interface is small on purpose.

### Hosts that store JSON

A host that keeps documents as JSON in its own database uses `host`. Y.js state, the log and
the rest are kept in `cache`; a document the cache lacks is made from the host's JSON (its
content, and its comments for a type with them). The JSON goes back to the host a while after
each change to the content or the comments (`settleAfter`, 2 seconds by default) while the
document is open, and when it is unloaded.

```ts
import { host, sqlite } from '@dotvoid/y-quorum'

const storage = host({
  load: (namespace, id) => loadFromDatabase(namespace, id),
  store: (namespace, id, document) => saveToDatabase(namespace, id, document)
}, { cache: sqlite('cache.sqlite') })
```

With `memory()` as the cache, the default, every restart seeds documents from the JSON again,
with a new incarnation: clients drop the copies they hold and start again from the server.

> **Not yet:** changes made to the JSON outside the server are not merged into a live
> document; a document is seeded from the host only when the cache lacks it.

### Retention

The log and the history keep every change, which grows. `server.prune(namespace, id, before)`
drops what is older than `before` (milliseconds since the epoch): the log's writes, and the
payloads of the history's entries. It keeps the latest checkpoint, the versions, and the
history's chain of hashes, which still verifies.

```ts
const DAY = 24 * 60 * 60 * 1000
await server.prune('team-1', 'plan-1', Date.now() - 90 * DAY)
```

Time travel then reaches the versions, and the time after `before`; asked for a moment in
between, the server says it is no longer kept rather than show it wrong. Who did what stays in
the chain and the register: retention limits the content, never the record of who acted.

### Deleting

`server.delete(namespace, id)` deletes a document everywhere it is kept: log, checkpoints,
versions, records, history, register and claims. Those who have it open are told it is `gone`.
`server.delete(namespace)` deletes a whole namespace. With more than one node, the document's
lease ends first: the node holding it writes nothing more, and closes it as `gone` when it next
renews its lease.

## More than one node

One process serves many documents. For more, run several nodes on a shared store that keeps
leases (`postgres`, or `sqlite` for processes on one machine, or `s3` over either):

```ts
const nodeSecret = process.env.NODE_SECRET
if (!nodeSecret) {
  throw new Error('NODE_SECRET is not set')
}

const server = createServer({
  types: [planType],
  storage: postgres(new Pool({ connectionString: process.env.DATABASE_URL })),
  authenticate,
  // This node, as the others reach it
  node: { id: process.env.HOSTNAME ?? 'node-1', address: `ws://${process.env.POD_IP}:1234` },
  nodeSecret,
  leaseTtl: 10_000
})
await server.listen(1234)
```

- **One node holds each document,** by a lease in the store, renewed while it is loaded. The
  node that is asked for a document no one holds takes it.
- **Clients connect to any node.** A node asked for a document another holds passes its frames
  on to that node, over a connection that speaks for the client, signed with `nodeSecret`. No
  routing by document is needed at the load balancer, though it saves a hop.
- **Every node needs the same `nodeSecret`,** and each a unique `id` and an `address` the
  others reach. The node reads `address` when it takes a lease, so it may be filled in after
  `listen`.
- **Writes are fenced.** Every write carries the lease's epoch; a store refuses a write from a
  node whose lease has passed to another, so a node that lost a document, paused or cut off,
  writes nothing more to it and sends its clients away to reconnect.

When a node goes away:

- **Shut down with `server.close()`,** it lets its documents go at once, and the next node
  asked takes them.
- **Crashed or unreachable,** its documents move when their leases run out, after `leaseTtl`
  (10 seconds by default). Openings forwarded to it wait for that and are then served by the
  node that takes the document.
- **Its clients reconnect,** to whichever node the load balancer gives them, and open their
  documents again. Changes not yet acknowledged are sent again; nothing a client typed is lost.

Code in the server process (below) works on the node that holds the document. On another node,
`transact`, `read` and the rest throw, naming the node that holds it; `send` passes the message
on to the node holding the document.

> **Not yet:** presence per namespace shows only the clients on the follower's own node. A
> node whose store stalls while its network lives keeps taking relays, and the documents it
> holds hang until it is restarted.

## Code in the server process

Code beside the server works on documents through the same rules as everyone, always as an
actor: there are no anonymous writes.

```ts
import * as Y from '@y/y'
import { addItem, type Actor, type ListField } from '@dotvoid/y-quorum'

const importer: Actor = { principal: { kind: 'service', id: 'importer', name: 'Importer' } }

const accepted = await server.transact('team-1', 'plan-1', importer, (content) => {
  content.setAttr('status', 'ready')
  const tasks = content.getAttr('tasks')
  if (tasks instanceof Y.Node) {
    addItem(tasks, plan.content.fields.tasks as ListField, { id: 'check', title: [], done: false })
  }
})
```

| Method | Does |
|---|---|
| `create(namespace, id, type, initial?, actor?)` | Creates a document, filled from JSON |
| `transact(namespace, id, actor, change)` | Makes `change` on a copy of the content and sends it through the write pipeline, with the roles `authorize` gives the actor (or whom it acts for), and refused when it adds a problem (see [Repairs](#repairs)). Resolves to whether it was accepted. |
| `read(namespace, id)` | The content as JSON, or nothing when there is no such document |
| `comments(namespace, id)` | The comment threads, oldest first |
| `appendRecord(namespace, id, actor, kind, data)` | Appends a record, see [Records](#records) |
| `send(namespace, id, message)` | Sends a message of yours to every client that has the document open, such as "saved by the publishing system" |
| `people(namespace, id)` | The register of people the history names |
| `unreviewed(namespace, id)` | What agents wrote that no person has reviewed |
| `exportHistory(namespace, id)` | The history as JSON Lines |
| `prune(namespace, id, before)` | Retention |
| `delete(namespace, id?)` | Deletes a document, or a namespace |
| `close()` | Closes connections, stores every loaded document and lets go of its leases |

`transact` suits plain fields, list items and structure. To edit text the way an editor does,
connect with the client from Node, with a token for a `service` principal, and bind a headless
textbit editor to the field (see the client guide): its changes are then repaired by textbit's
rules before they are sent.

Typed functions clients call go in `rpc`, as in the `publish` example above. A handler gets the
arguments as the client sent them, to check, and the caller's principal; what it returns, or
the message of what it throws, goes back to the client. Workflow belongs there: a handler that
checks and changes a document in one `transact` writes atomically, under the policy.

> **Not yet:** hooks before a write or before awareness is passed on, and events for hosts
> (content changed, comments, suggestions, versions), with an outbox for webhooks. An HTTP API
> for writers in other processes; they use the client from Node today.

## Agents over MCP

`@dotvoid/y-quorum/mcp` lets agents work in y-quorum documents over the Model Context Protocol.
It is a module your HTTP server mounts, and a y-quorum client like any other: it works as the
person the agent acts for, every change claimed as the agent's, so the policy, the history and
review evidence apply to agents as to everyone. You supply who is calling and which documents
they may find; it supplies the tools. See
[Agents over MCP](./agents-mcp.md#agents-at-a-y-quorum-server).

## Next

- [y-quorum, the client](./y-quorum-client.md)
- [Suggestions](./suggestions.md)
- [Agents](./agents.md) and [Agents over MCP](./agents-mcp.md)
- [Collaboration](./collaboration.md)
- [What's new in 3.0](./whats-new-in-3.md) and [Upgrading from 2.x](./upgrading-from-2.md)
