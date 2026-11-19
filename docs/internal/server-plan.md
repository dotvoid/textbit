# A server for people and agents

Status: proposal, third revision, after a review by a project that uses textbit and notes from
a team that built a similar service on Y.js 13 and Slate. Nothing is built yet. Written
19 November 2026, with Y.js 14 at release candidate 30 and MCP at revision 2026-07-28.

Textbit 3 lets agents edit alongside people. What it cannot do on its own is make that
accountable: say who changed what, on whose behalf, approved by whom; let a person comment on
a document they may not edit, with the server holding everyone to their role; let an agent
work across many documents; and replay how a document came to be. That needs a server. This
plan proposes one of our own, on Y.js 14, together with the Slate binding for Y.js 14 that
textbit needs anyway.

The aim: the best framework for documents that people and agents write together, with people
in control and every change accounted for.

## Principles

- **People stay in control.** An agent's rights are never more than those of the person it
  acts for, and a document can say what agents may do there: nothing, read, comment, suggest
  or edit. Accepting a suggestion is a person's act and is recorded as theirs.
- **Every change has an actor, decided by the server.** Identity is fixed when a connection
  authenticates and stamped on every change, never taken from what a client says about itself.
- **History is never rewritten.** Restoring a version or reverting an agent's work is a new
  change. Erasure, when the law requires it, is an explicit, recorded redaction.
- **The content holds content.** Comments, suggestions, records, attribution and history live
  beside the document, never in it (see `docs/background/comments-and-suggestions.md`).
- **The server checks what a write does, not only who sends it.** A person's write is refused
  only for rights; a wrong shape is repaired, because refusing a CRDT update throws away their
  typing. Agents and API writes are validated before they apply.
- **Many documents, many views.** A browser tab may hold hundreds of documents open, and the
  same document in several editors at once, over one connection.
- **Generic, not one host's model.** Documents are typed trees in which rich text is one kind
  of field. Nothing in the server is specific to articles, newsrooms or any one host.
- **Nothing needs infrastructure to start.** One process and a SQLite file run everything;
  Postgres, S3 and more nodes are for when a host needs them, and a host's own storage can be
  used from the start.
- **Hosts that store JSON are served,** with less history but the same rules.

## Decisions

1. **Write it fresh.** We take Hocuspocus's lessons, not its code or its decisions.
2. **Textbit 3 moves to Y.js 14,** a clean break for live collaboration. Stored Y.js 13
   documents load; 2.x and 3.x clients cannot edit the same document at once. Our own binding
   replaces `@slate-yjs/core`.
3. **Suggestions use the Y.js 14 fork from the start,** for people (suggesting mode with
   editable suggested text) and agents alike. The fallback, if the spike shows the fork is not
   ready, is the anchored operations of the background document.
4. **The server lives in this repository,** MIT, Dotvoid AB.
5. **Textbit 3.0 is released when Y.js 14.0 is.** Until then we build against pinned release
   candidates and re-verify at each.
6. **The name: y-quorum,** `@dotvoid/y-quorum` for the server and `@dotvoid/y-quorum-client`
   for the client. People gathered with the right to decide; the `y-` prefix follows Y.js's
   convention and tells it apart from other projects called Quorum.
7. **No prereleases for production.** We build until 3.0 is done; storage formats may change
   without migration until then.

## What we found

Four investigations and one review by a host, summarised; the details that matter are in the
sections below.

**Y.js 14** (`@y/y`, MIT):
- One node type for everything: a name, attributes, and children that mix formatted text and
  child nodes. A Slate tree maps onto it directly, and so does a document tree with plain
  fields, lists and several rich-text fields. Changes are read and written as lib0 deltas.
- Documents stored by Y.js 13 load in 14 and relative positions are byte for byte the same,
  **but a 13 client and a 14 client cannot edit one document together.**
- Attribution is data outside the document, computed by a server from the updates it receives,
  per connection. So **attribution follows the connection**: an agent editing in a person's
  own Y.Doc is attributed to the person unless we say otherwise.
- History: versions are sets of content ids; past states and differences between any two
  versions render with attribution; restoring and selective undo work through
  `undoContentIds`; all of it needs documents kept without garbage collection. The snapshot
  API was replaced in rc.30 itself: APIs still move.
- Suggestions: a fork kept in step with the base, differences rendered as attributed changes,
  accepted or rejected per contiguous run.
- No first-party comments, no multiplexing of documents over one connection, no move
  operation. Undo has open bugs. npm's `latest` tag is still rc.7; release candidates come about
  monthly; no date for 14.0.

**Collaboration servers:** Hocuspocus keeps documents in memory, has a good lifecycle,
pre-authentication limits and many documents per socket, but one read-only bit per connection,
silent drops of refused writes, whole-document storage without history, anonymous server-side
writes, untyped hooks, and a session-id hack to open one document twice. yhub streams updates
without holding documents and cannot check what a write means; it is AGPL or proprietary.
y-sweet, Durable Objects and automerge-repo show the single-owner model and lock-free
compaction.

**MCP** (2026-07-28): stateless; state between calls belongs in handles passed as arguments,
re-authorized on every call, which is how textbit's handles and revisions work. Streamable
HTTP only, with a header so a load balancer can route by document. OAuth 2.1, client id
metadata documents, no token passthrough. The lab and the MCP guide now use SDK v2.

**History and accountability:** a 6,000-word article typed keystroke by keystroke by three
people is about 280 KB of updates batched per 10 seconds; replaying all of it takes 80 ms.
Reverting an agent run after people edited around it puts deleted text back where it was, which
can read wrongly, so it must be shown as a suggestion. Restoring after a selective revert lost
text in rc.30, probably an upstream bug. A record of which ranges agents wrote and who reviewed
them is the evidence Article 50(4) of the EU AI Act asks of publishers (to be checked by someone
qualified before it goes into public documentation). No product we looked at records person,
agent, client and run together on every change.

**The host's review** (a project on textbit 2 and Hocuspocus 4, not in production): supports
the direction, and found the model of "one textbit body with comments beside it" too narrow.
Its documents hold several rich-text fields, plain fields, keyed lists of items with text of
their own, append-only logs of acts, rights that depend on the document's state and on single
fields, presence across documents, and writers in other processes. Its Hocuspocus layer is
mostly workarounds for what this plan proposes to do properly. Its points are taken into this
revision; where we differ, it says so.

**Notes from a team that built this** (a newsroom editor on Y.js 13 and Slate, with a service of
their own in place of Hocuspocus, about forty decision records, several reversed): the
direction matches where they ended up. Their hard-won lessons, each taken in below:
- Several editable views of one Y.Doc was their riskiest idea, and they went back on it. A Slate
  editor is a mirror of the shared text kept up to date by replaying deltas, with nothing that
  checks it; two mirrors in one tab means one mistake leaves one silently wrong. Both their
  failures were bugs (a binding that reversed a shared delta array in place; an unfocused view
  taking the caret), not the CRDT.
- Loading and rendering must never write, or every reader becomes an author in the attribution
  map. Whoever inserts a thing sets its id; repairs are the server's alone, because clients
  repairing the same thing at once duplicate or delete it.
- A refused update leaves the client's clock ahead of the server for good: every later update
  from that client id waits for ever. Rebuild under a new client id.
- Versions that missed what the person had just typed were their hardest bugs: only the owner
  makes a version, at a state the client names and the owner has.
- Outside changes should be merged, not start a new incarnation; emptied is not empty.
- Local copies belong to a person, not a browser; single values stored as nodes duplicate under
  concurrency; presence needs a mode; background tabs throttle timers; many documents per
  socket needs limits in the protocol; tests against fakes proved less than they seemed.

## The document model

### Types and trees

A document has a type, fixed when it is created and stored in the server's own metadata. Its
content is one tree described by the type's schema, which the server understands:

```ts
const assignment = object({
  id: id(),
  title: text({ plugins: singleLine }),
  status: oneOf(['todo', 'done']),
  description: text({ plugins: basic })
})

defineType('example/plan', {
  content: object({
    title: text({ plugins: singleLine }),
    due: date(),
    assignments: list(assignment, { key: 'id' })
  }),
  comments: true,
  suggestions: true,
  records: { 'status.changed': statusChange },
  policy: planPolicy,
  history: true
})

defineType('example/tag', { content: object({ name: string(), kind: oneOf(tagKinds) }) })
```

- **Field kinds:** scalars (`string`, `number`, `boolean`, `date`, `oneOf`, `id`), `object`,
  keyed `list`, and `text`: one textbit body with its own plugin configuration, anywhere in the
  tree, inside lists too. A single-line configuration covers titles.
- The server needs the kinds to know which fields are text and how list items are keyed; a
  Standard Schema may be attached for further rules on values.
- **Every text field and every list item has a stable id.** Comments, suggestions, cursors and
  the agent's handles name a text field by its id, never by path, because list positions move.
  Paths are for display.
- `server.create(namespace, id, type, actor)` creates a document; loading looks the definition
  up by the stored type. No matching of types by name pattern.
- History, comments, suggestions and records are each opt-in per type: preferences and tags
  need none of them.

### In Y.js 14

- The content is one Y.js node; objects map their fields to attributes or child nodes; a text
  field is a child node holding textbit's blocks.
- **Text fields are created with their parent, never on first use.** Two clients creating the
  same text field at once keep one and lose the other person's text entirely (tested).
- **A single value is always an attribute, never a node.** Attributes are last writer wins per
  key, the same on every client, so a status or a priority set by two people at once ends with
  one value. Stored as a node, it would end with two.
- Where copies can still arise (two list items, or two text fields, created with the same id at
  once), **only the owner removes them,** deterministically: the earliest by Y.js id stays. If
  every client removed "the other" copy, all copies could go.
- **Lists are ordered by a position attribute, not by moving.** Y.js has no move: moving an
  item by deleting and inserting it would give its text new identities, detaching comments,
  suggestions and attribution. Each item carries a fractional position; reordering changes only
  that. Two people adding an item with the same id at once is repaired by the server, as textbit
  already repairs exact copies.
- Which of these Y.js 14 supports directly (child nodes as attribute values, for one) is a
  question for the first spike.

### Companion layers

- **comments** and **suggestions** as before. Suggestions fork the whole tree, so a suggestion
  can add a list item or change a date as well as edit text.
- **Each layer is a Y.Doc of its own,** following Y.js 14, which keeps suggestions in a fork:
  the content's Y.Doc holds only content. Comments were first built as a second root of the
  content's Y.Doc and moved out the same day, after comparing with the Y.js 14 and BlockNote talk
  at FOSDEM 2026: a fork of the content must not carry the comments, a provider without our server
  can then grant comments and content separately, and versions and restores of the content never
  touch the comments. Updates name their layer; the server judges each layer by its own rules.
- **records:** append-only entries with a schema per kind from the host: status changes, AI use,
  acknowledgements, dismissals. The server stamps actor and time, entries are never edited,
  and they are part of the hash chain. Records are not a CRDT: a client asks, the server
  appends and broadcasts.

### Rights from state, per field

```ts
policy: ({ actor, roles, layer, paths, content, next }) => Capabilities
```

The policy sees the document as it is (`content`) and, for a write, as it would be after it
(`next`): a rule like "published documents are read-only" must judge the state before the write,
or it refuses the very write that publishes.

- A pure, synchronous function. The server computes the paths a write touches from the decoded
  update, without applying it, by resolving each new or deleted item to its place in the tree.
- **The server re-evaluates the policy for every open connection whenever content changes**:
  a document that becomes published becomes read-only for everyone at once, without the host
  calling anything. The document's agent policy is a field the policy reads.
- Workflow stays in the host: it has the policy, typed `rpc` handlers that write atomically,
  and records.

## Many documents and many views in one tab

### Many documents

- **One socket per tab** carries any number of documents. Frames name their document; opening
  many at once is one frame with their state vectors, answered in one batch.
- **Two ways to hold a document:**
  - `open`: the full Y.js document, editable, kept in step;
  - `watch`: a projection of chosen fields as JSON, read-only, pushed when they change,
    debounced by the server. A list of three hundred items showing title, status and assignee
    watches them; it opens one when someone edits in the list.
- Watching is cheap on the server: a projection of a document that is not loaded is served
  from storage; only documents someone has open are held in memory.
- **Limits are part of the protocol.** The handshake states how many documents a connection may
  open and watch. The client keeps a budget: hidden and least recently used documents are
  demoted from open to watch, and closed after a grace period. Going over the limit is refused
  with a reason code of its own, never read as an outage.
- **Presence per namespace** says who has which documents open, for lists and dashboards,
  separately from the cursors inside one document. Per-document awareness is only sent to
  views that ask for it.
- **Presence has a mode:** watching, reading or editing. Having a document open and working on
  it mean different things to people. Watched projections do not count as presence at all.
- **Liveness comes from the connection,** not from timers in the page: browsers throttle timers
  in background tabs to about once a minute and mobile systems close sockets. Visibility is sent
  as an explicit state when it changes. The client keeps the connection alive with protocol
  pings the server answers, never with timers it depends on.

### Many views of one document

The same document in a list row and in a full editor, in the same tab, both editable:

- **One Y.Doc per document per tab,** shared by reference-counted handles. Every view binds to
  it, so each view sees the others' changes at once, without a round trip, and the server sees
  one client. Hocuspocus's second connection per document is not needed.
- **Each view has its own origin,** and so its own undo history: undo in the list does not undo
  typing in the editor. A view binds to the fields it edits, a text field by its id.
- **Each view has its own cursor** in the tab's awareness state for that document, keyed by
  view, so a person with two editors open shows two carets.
- **A view may act as someone else:** an agent working in the page is a view whose writes carry
  an actor claim (agent, run, model), recorded as acting on the person's behalf when the
  person's token allows agents. The client sends each view's writes in frames of their own.
- What a view may do (some actions in a list, everything in the editor) is the view's own
  configuration; what the person may do is the server's policy, the same for every view.
- A document is released when its last handle is, after a short grace period, so a list that
  re-renders does not reopen it.

### Keeping several editors honest

Several editable views of one document is the riskiest idea in this plan, and the team that
built it went back to one view per document. We keep it, because the use cases need it, and
the spike bears it out (`apps/spike-y14/FINDINGS.md`): two editors on one text field and a
third on another client converged in 400 runs of 1,000 random edits each. The binding is built
for it:

- **Plain fields have no mirror.** A list row editing a status reads and writes the Y.js
  attribute directly. Most "second views" in a list edit plain fields, so the risk exists only
  where two Slate editors bind the same text field.
- **Editors are compared with Y.js, not fed replayed deltas.** On a change, each editor reads
  the blocks it touched from Y.js and is brought to them with the smallest Slate operations
  found by comparing. A mistake cannot accumulate through replaying, and each change to a
  block corrects that block. (The earlier idea, one translation shared by every editor, is not
  needed.)
- **Event deltas are read-only.** Y.js hands the same delta to every observer; the binding only
  reads which blocks they touched, never changes one.
- **Each editor can be checked and re-read.** A hash of the editor's value is compared with one
  computed from Y.js when a view gets focus and after idle periods; a mismatch re-reads the
  field from Y.js, keeps the selection where it can, and is counted.
- **Focus decides the caret.** Only the focused view writes a cursor to awareness; an unfocused
  view never moves or clears the person's caret.
- **A convergence test is a release gate:** several editors on one text field, in one tab and
  across clients, under random edits, compared with Y.js and with each other after every step.
- The fallback, not needed so far, is the team's runner-up: one editable view per text field,
  the others derived and read-only.

## The binding

- Modelled on `@y/prosemirror` 2's architecture: a Y side and a Slate side joined by a pipeline
  that renders attribution into what the editor shows and strips it before anything reaches Y.
- An editor binds to **a text field node at any place in the tree,** by its id.
- **Slate to Y** maps Slate operations to deltas directly (`insert_text` and `remove_text` to
  retain, insert and delete; `set_node` to attributes; split, merge and move to delete and
  insert), with a diff as the fallback for normalization and fixes.
- **Y to Slate** applies the node's delta events as Slate operations.
- **Mapping:** element type as the node's name; `id`, `class` and each property as its own
  attribute, so two people changing different properties do not overwrite each other; marks as
  formats; inline elements as child nodes.
- Attribution, history views and suggestions render as decorations that never enter Y.
- **Loading and rendering never write.** With attribution on every change, a client that
  normalized on load or gave a missing id one while rendering would make every reader an author
  and produce false "changes since you last reviewed". On a shared document, textbit's
  normalizers run only on the person's own operations; whoever inserts an element sets its id;
  anything found broken on load is left to the owner to repair. This changes textbit 3 as built:
  the exact-copy repair in `withNormalizeNode` moves to the server.
- Plugins reach documents through textbit's and the client's API, never through Y.js, so the
  next change in Y.js is not a break for them.

## The server

### In memory, one owner per document

Each open document is held in memory by one owner, which serializes its writes, as Durable
Objects and y-sweet do; streaming without documents cannot check what a write means.

### Namespaces

A namespace is a boundary: ids are unique within it, nothing crosses it, and storage, leases,
presence and deletion work per namespace. `authenticate` returns the namespaces a principal may
enter; a host with customers maps each to a namespace; a host without may still use several.
Deleting a namespace is one call, and storage adapters may lay data out per namespace.

### The handshake

Before any document state is exchanged:

- **Protocol version.** An old bundle is told to reload instead of being served.
- **Identity and namespaces,** from the host's `authenticate`.
- **Client id claims.** The client proposes the Y.js client ids it will use; the server refuses
  one already claimed by another principal and the client picks another, so nobody writes
  under someone else's id. (Y.js 14's ids are 53-bit, so accidental collisions are no longer a
  practical concern: about one in 200 million among 10,000 ids.)
- **Incarnation per document,** sent before the client sends any local state, so a copy kept in
  IndexedDB from an earlier incarnation (a reseeded or wiped document) is discarded, never
  merged.
- **Limits:** how many documents may be opened and watched, and frame sizes.

After the handshake:

- **Tokens are renewed without reconnecting,** with a frame of their own, so expiring tokens do
  not cause reconnect storms. A renewed token may change roles; a different principal closes
  the connection, for example when another tab logs in as someone else.
- **Local copies belong to a person.** Copies and pending updates in IndexedDB are keyed by
  principal. Updates made under one login are never sent under another: the server would
  attribute them to whoever is logged in when they are sent, on a shared machine someone else.
  They are held for their author or handed to the app.

### The write pipeline

1. Decode the frame: document, layer, the view's actor claim if any, the update.
2. Check the client id is this connection's.
3. **Wait until it can be integrated.** An update may arrive before one it depends on; it is
   held, within a limit per connection, until what it depends on is there. Only then are the
   paths it touches known.
4. Compute the paths it touches and ask the policy; comment and suggestion ownership is checked
   here too. An update that touches allowed and refused fields can only be refused whole, which
   is why the client sends each view's writes separately.
5. Agent and API writes: apply to a copy and validate first.
6. Append to the log (committed in groups every 10 to 20 ms), apply, broadcast (coalesced per
   tick), acknowledge, fire events, re-evaluate policies if content changed.
7. People's writes with a wrong shape are repaired afterwards by the owner, and only the owner,
   as a `system` change: text fields by textbit's rules, other fields back to their last valid
   value.

**A refused write is not lost, and does not wedge the client.** Once the server refuses an
update, the client's state covers changes the server will never have, and every later update
under that client id depends on them and would wait for ever. So the client **rebuilds the layer
from the server's state under a new client id,** and **hands the refused changes to the app** (the
update and what it would have changed, as JSON), which may keep them, show them, or offer them
as a suggestion. That matters most for a document that became read-only while someone edited
offline.

**Policy changes are numbered.** When a change makes a document read-only (publishing, a running
AI step), updates are already on their way. The server announces "from log position N you may
only read", so the client knows which of its updates were judged by which rule.

**Transitions settle first.** Before a person asks for a change of state such as publishing, the
client delivers everything it holds and waits for the acknowledgement; the request names the
state the client has, as for versions below.

**Every rejection and error has a typed reason code** in one fixed place in the frame: not
allowed, over a limit, stale protocol, invalid, conflict, unavailable. Nothing is read from
message text.

**Each document counts what goes wrong:** pending updates, rejections, repairs, rebuilds,
re-reads of an editor. A mirror out of step or a stuck clock usually shows first in one of these.

### Roles and capabilities

Roles are the host's; the policy maps them to capabilities per layer and field. The defaults
for a type without its own policy:

| Role | Content | Comments | Suggestions | Versions |
|---|---|---|---|---|
| reader | read | read | read | read |
| commenter | read | create, reply, edit and resolve own | read | read |
| suggester | read | as commenter | propose, edit and withdraw own | read |
| editor | write | all, resolve any | accept, reject | create |
| owner | write | all | all | restore, revert, manage |

An agent is an actor kind, not a role: its rights are the intersection of its grant, the
person's role and the document's agent policy (`none`, `read`, `comment`, `suggest`, `edit`,
`edit-confirm`).

### Identity

```ts
type Principal = { kind: 'person' | 'agent' | 'service', id: string, name: string }
type Actor = {
  principal: Principal
  onBehalfOf?: Principal
  run?: string
  client?: string   // the MCP client or app, verified where possible
  model?: string    // claimed, never verified
  connection: string
}
```

Fixed at authentication; awareness stamped by the server, so nobody appears as someone else and
an agent always appears as an agent, with whom it acts for.

### Writers in other processes

Every writer goes through the document's owner. Services (AI steps, ingest, erasure, media)
connect over the network as `service` actors, with `onBehalfOf` where they act for someone, and
write any field, not only text: over the client in Node, or an HTTP API that takes changes to
fields and textbit operations on text fields. Code in the server process uses
`server.open(document, actor)`. There are no anonymous writes.

### Hooks and messages

- **Interceptors:** `authenticate`, `load`, `beforeWrite`, `beforeAwareness`, `beforeUnload`,
  and typed `rpc` handlers for calls from clients.
- **Events,** after the change is stored, each with a stable id so hosts can drop duplicates,
  through an outbox for webhooks: comments (created, replied, edited, deleted, resolved,
  reopened, mentioned, detached), suggestions (proposed, accepted, rejected, withdrawn), runs
  (started, finished, reverted), versions (created, restored, published), records (appended),
  content (changed, with paths; repaired), connections (opened, closed).
- **Messages to clients:** `server.send(document, message)` pushes a host's message to a
  document's clients, such as save state.

### Storage

```ts
interface Storage {
  acquireLease(doc: DocRef, node: string, ttlMs: number): Promise<Lease | null>
  append(doc: DocRef, entries: LogEntry[], epoch: number): Promise<void>
  read(doc: DocRef, fromSeq?: number): Promise<{ checkpoint?: Checkpoint, entries: LogEntry[] }>
  writeCheckpoint(doc: DocRef, checkpoint: Checkpoint, epoch: number): Promise<void>
  projection(doc: DocRef, paths: string[]): Promise<unknown>
  history: HistoryStore
  versions: VersionStore
  records: RecordStore
  delete(target: DocRef | Namespace, mode: 'soft' | 'hard'): Promise<void>
}
```

- Adapters: `memory`, `sqlite` (the default for one process), `fs`, `postgres`, `s3`.
- **`host`, from the first server release:** loading and debounced storing handed to the host's
  own callbacks, in JSON or Y.js, so a host on its own database adopts early. The full log and
  leases can follow later.
- More nodes: a lease per document with an epoch on every append, routing by document at the
  load balancer, forwarding to the owner otherwise.

## History

### Two records with two jobs

- **The log** records who and why. Entries are appended as writes arrive and folded by the owner
  into batches (one actor, connection and layer, at most 10 seconds, cut at runs and versions);
  the hash chain is built over the batches.
- **The attribution map** (Y.js 14's ContentMap) indexes which actor wrote or deleted each
  range: `insert` and `delete` set to the actor's id, `insertAt` and `deleteAt`, and prefixed
  keys `insert:run`, `insert:onBehalfOf` and their `delete:` equivalents. Computed at receipt,
  after subtracting what the server already holds.

```
history entry:
  doc, seq, layer (content | comments | suggestions | records), at,
  actor, onBehalfOf, connection, run, toolCall, model (claimed),
  kind (edit | accept | reject | restore | revert | import | redaction | system),
  refs (acceptedFrom, restoredTo, revertOf, approval),
  payload (merged Y.js update, may be removed later), payloadHash,
  prevHash, hash
```

- Checkpoints every 500 entries and at every version: the uncollected state of each layer, the
  attribution map, state vectors, the head hash. Rebuildable from the log.
- One sequence per document across its layers, so a document and its comments at a moment are
  one consistent state.

### What people can do with it

- **Scrub through time,** layers in step; **see what changed between any two versions and by
  whom,** filtered by person, agent or run.
- **Versions** take the host's own version id and metadata, a canonical form the host supplies
  (for example the cleaned document it publishes), and a pluggable signer, so a host does not
  run two numbering schemes or two key systems. Automatic versions before every restore or
  revert.
- **Only the owner makes a version, at a state it can prove.** A client asking for one sends
  "what I have", its state vector; the owner waits until it holds all of that, then cuts the
  version at that log position. The host's canonical form is computed from the owner's state at
  that position, never sent in by a client. A browser never produces the stored form of a
  document: not on unload, not when typing pauses, not before a save.
- **Restore a version** as a new change; **revert an agent run** by placing its inverse in the
  suggestions layer for a person to accept.
- **Review evidence:** "reviewed" is an explicit act a person performs on a range or a run (an
  accept, or a "reviewed" action), never viewing it or editing nearby. A fast query lists text
  agents wrote that no person has reviewed since, for a host's publishing gate.

### Accountability

- A SHA-256 hash chain per document; signed checkpoints and versions; an optional anchor
  outside the server.
- Agent entries record the person they acted for, agent, model (claimed), client, run, tool
  call, the revision the edit was made against, an optional `intent`, and approvals. An accepted
  suggestion leaves two facts: the agent suggested, the person accepted.
- Export as JSON Lines with a verifier, and as W3C PROV.

### Erasure and retention

- Actors are pseudonymous ids; names live in a table that can be erased; prompts and intents
  are stored apart and can be erased.
- Erasing content is a squash with a signed redaction entry. **It may cross named versions,**
  leaving a signed tombstone where the version's content was, because a person's right to
  erasure cannot depend on whether something was published.
- **Deleting a document or a namespace** covers everything: log, checkpoints, versions,
  records, client id claims, stored `opId`s, names, prompts and intents.
- Retention per host: full payloads for N days, then headers and checkpoints.

## The MCP module

A module the host mounts (`@dotvoid/y-quorum/mcp`), not an endpoint built into the server:
listing and searching documents needs the host's index and namespaces, and authorization needs
the host's identity provider and API keys. The host supplies discovery and authorization; the
module supplies the tools, resources and prompts, on SDK v2, protocol 2026-07-28. Every call
through MCP is an agent action: people edit over the socket.

**Tools** (each document tool takes `doc`; each write takes `revision`, `opId`, and optionally
`run` and `intent`):

| Group | Tools |
|---|---|
| Discovery | `documents_list`, `documents_search` (through the host) |
| Reading | `document_read` (an outline of the tree, a field, or a text field's lines), `document_search`, `document_types`, `document_changes` (since a revision, and by whom) |
| Writing | `document_suggest`; `document_edit`, refused where the policy says suggest, or asking the person first where it says `edit-confirm`; both take changes to plain fields and list items as well as textbit operations on text fields |
| Records | `records_list`, `record_append` (kinds the type allows agents) |
| Comments | `comments_list`, `comment_create` (anchored by text field, handle and quote), `comment_reply`, `comment_resolve` (own threads unless granted) |
| Suggestions | `suggestions_list`, `suggestion_withdraw` (own) |
| History | `history_list`, `history_show`, `run_revert` (own runs, as a suggestion) |
| Runs | `run_start` (with intent), `run_finish`; otherwise a run closes after a pause |

- **The line format and handles name the text field they belong to;** plain fields are read
  and written as JSON by path.
- **Durable revisions:** server-stored ids mapped to content ids, so any node can tell what
  changed since, after restarts too. `opId`s are stored per principal.
- **Authorization:** an OAuth 2.1 resource server with protected resource metadata, or the
  host's API keys; the token's subject is the person, an `act` claim names the agent. Scopes:
  `docs:read`, `comments:write`, `suggestions:write`, `docs:write`, `records:write`.

## Hosts that store JSON

- The JSON form of a document is its tree; records and comments come out as JSON records with
  both anchors (text field id, relative position, and text selector).
- The `host` storage adapter loads and stores JSON, and the server seeds Y.js from it.
- **Changes from outside are merged, not reseeded.** When the stored JSON changed outside the
  server (an import, a service), the owner turns the difference into changes to the live
  document by a `service` actor: fields by path, text fields by block id and words. People's
  unsent typing and offline work survive. A new incarnation is only for a real wipe or reseed.
- **Emptied is not empty.** A field a person has cleared must not be filled again from a stored
  value, or deleted text comes back. The document records per field whether a person has
  written it; emptiness is never the test.
- **A seeded value replaces, never refills in place.** Seeding a new value into a text field a
  person may be starting to type in races with them; the new value goes in as a new text field
  node that replaces the old one in one change. Comments anchored in the old value detach, as
  for any replaced text.
- History for JSON hosts is the log's headers with field-level and textbit-level changes
  instead of Y.js updates, plus snapshots at versions.

## What changes in textbit 3 as built so far

- `@slate-yjs/*` gives way to `@y/y`; an editor binds to a text field by id.
- The suggestions map in the content document and its store are replaced by the fork; the
  review interface carries over.
- Repairs move to the owner: the exact-copy repair leaves `withNormalizeNode`, and shared
  editors no longer normalize on load.
- The agent package: handles and the line format name their text field; tools read and write
  plain fields; agent writes carry an actor claim; revisions become durable with a server.
- The lab moves from Hocuspocus to the new server. (Its MCP server is already on SDK v2.)
- `docs/guides/formats.md`, `collaboration.md`, `suggestions.md` and the background document
  follow.

## Order of work

0. **Spikes,** each answering one question with running code. Done 19 November 2026; the
   results are in `apps/spike-y14/FINDINGS.md`:
   - a Slate binding on Y.js 14 bound to a text field inside a typed tree: load a 13 document,
     edit, cursors, undo per view, two clients;
   - two editable editors on one text field in one tab, with one translation applied to both,
     the editor check and re-read, and the convergence test: this decides whether several
     editable views stay or fall back to one;
   - the tree in Y.js 14: objects, keyed lists ordered by position, several text fields;
   - suggestions in the fork over a mixed tree: text, a plain field, a new list item; accept and
     reject per run; an agent suggesting; a person typing in suggesting mode;
   - the restore-after-revert failure reduced to a report for Y.js upstream.
1. **The binding** in core, with the demo on a minimal server. Done 19 November 2026: core
   binds editors to Y.js 14 text fields with its own binding (`packages/textbit/lib/yjs`);
   slate-yjs and Y.js 13 are gone from its dependencies. The typed document model moved to
   step 2, as server and client share it.
2. **Server core:** the handshake, documents and types, namespaces, the client with many
   documents and views, memory, SQLite and `host` storage, policies, the write pipeline,
   awareness and namespace presence, records, writers in other processes. The lab moves to it.
   Done 19 November 2026: `@dotvoid/y-quorum` and `@dotvoid/y-quorum-client`, the protocol and
   the model shared by both from the client's `/protocol` and `/model`; the lab and the demo run
   on them. Carried forward:
   - repairs by the owner (textbit's normalization on the server), and agent and API writes
     validated against the schema before they apply;
   - outside changes to a host's JSON merged into a live document; today a document is seeded
     from the host only when the cache lacks it;
   - local copies in IndexedDB keyed by person, and the client's budget demoting documents
     from open to watch;
   - an HTTP API for writers in other processes (they use the client from Node with a service
     token today);
   - READMEs for both packages, and the guides.
3. **Comments.** Server and client done 19 November 2026: threads in the comments layer, a Y.Doc of
   its own (`@dotvoid/y-quorum-client/model`), judged by `judgeComments` in the server against the
   roles' rights (`Capabilities.comments`: none, own or all; nobody edits someone else's words),
   `handle.comments` in the client, `server.comments()`, comments in a host's JSON, and agents
   commenting for a person. Anchors are stored two ways, relative positions and a quote in its
   block. The editor followed the same day: a comment store on `Textbit.Root` (core's
   `createCommentStore`, or `handle.comments.field(path)`), anchors from a selection,
   highlights, `useComments`, and a comments panel in the demo and the lab. Carried forward:
   comment events for hosts (webhooks), mentions, and agents' comment tools in the MCP module
   (step 6).
4. **History:** attribution, the log and checkpoints, versions, scrubbing, differences,
   restore, review evidence. Attribution done 19 November 2026, on Y.js 14's own pieces: the
   owner builds a `ContentMap` per layer from what each accepted write's transaction inserted
   and deleted (`insert`, `insertAt`, `insert:onBehalfOf`, `insert:run` and the `delete:`
   twins, people named `kind:id`), keeps it in checkpoints, rebuilds it from the log after
   them, and sends it to clients. `handle.attributionsRenderer()` is an `AttributionsRenderer`
   kept current; through it the editor marks text `_by` and `_at`. Versions followed the same
   day: a save by whoever may make versions (editors; owners restore) is a version at a log
   position, kept with the content's state; `handle.compare(from, to?)` shows the difference
   through `createDiffRenderer` on two copies, with who changed what; restore is Y.js 14's
   `undoContentIds` on what changed since, a new change in the restorer's name, after an
   automatic version of the content as it was. The content of a type with history keeps its
   deleted items (`gc: false`), which restoring needs. To come: scrubbing, the log batches and
   hash chain, review evidence, export.
5. **Suggestions in the fork,** people's suggesting mode, agents suggesting, run revert.
6. **The MCP module.**
7. **Production:** Postgres and S3, leases and forwarding, audit export, retention and
   redaction.
8. **Documentation, migration from 2.x, and the release** with Y.js 14.0.

## Testing

Tests against fakes prove less than they seem to. The server is in this repository, so the
client's tests run against the real server, in-process, with faults injected:

- frames dropped, duplicated and reordered;
- a reconnect between handshake steps;
- a restart of the owner in the middle of a write;
- two tabs for one person, and two people on one machine;
- a policy change while updates are on their way;
- several editors on one text field under random edits (the convergence gate).

Each test also checks the counters: no pending updates left, and no rebuilds or re-reads it did
not expect.

## Risks

- **Y.js 14 is a moving target.** Pin, wrap behind our own modules, re-verify at each release
  candidate, report upstream.
- **Accepting a suggestion needs Y.js item ids,** reachable only through internals today: a
  public way, upstream or our own wrapper, is needed.
- **Several editable views of one text field** went wrong for the team that built it before
  us. It passes our convergence gate; the gate stays a release requirement.
- **The fork's granularity** is a contiguous run of changes; in the spike, a text change, a
  plain field and a new list item were each accepted on their own. Anchored operations remain
  the fallback.
- **Scope.** This is a document model, a server, a binding, a client, history and MCP. Each
  step is usable on its own, and the lab runs on the new stack from step 2.
- **Time.** Textbit 3.0 waits for Y.js 14.0, which has no date.

## Sources

- Y.js 14: https://github.com/yjs/yjs (`src/ynode.js`, `src/utils/Renderer.js`,
  `src/utils/meta.js`, `src/utils/ids.js`, `INTERNALS.md`), https://www.npmjs.com/package/@y/y
- `@y/prosemirror` 2: https://github.com/yjs/y-prosemirror (`ARCHITECTURE.md`,
  `ATTRIBUTION.md`, `CAVEATS.md`)
- Hocuspocus: https://github.com/ueberdosis/hocuspocus
- yhub, for ideas only: https://github.com/yjs/yhub (`STORAGE-ARCHITECTURE.md`, `API.md`)
- y-sweet: https://github.com/jamsocket/y-sweet; automerge-repo storage:
  https://automerge.org/docs/reference/under-the-hood/storage/
- MCP 2026-07-28: https://modelcontextprotocol.io/specification/2026-07-28/changelog;
  TypeScript SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/
- OAuth token exchange, the `act` claim: RFC 8693
- EU AI Act Article 50 and the code of practice:
  https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content
- W3C PROV: https://www.w3.org/TR/prov-overview/
- Ink & Switch on history and AI edits: https://www.inkandswitch.com/patchwork/notebook/
