# Agents

An AI agent can read and edit a textbit document the way a person does: in the same document,
under the same rules, while people keep writing. `@dotvoid/textbit-agent` gives an agent
access to one editor's document and describes that access as tools a model can call.

The package owns no server, no model and no framework. You run the model; the package turns
its tool calls into edits that the editor checks like any other. Nothing in it needs React or a
browser, so the agent can work on a live editor in the page or on a headless one on a server.

```bash
npm install @dotvoid/textbit-agent
```

- To serve the tools to an MCP client or a model SDK, see [Agents over MCP](./agents-mcp.md).
- To run an agent on a server, in a document people edit in their browsers, see
  [Agents on a server](./agents-server.md).
- To let an agent propose changes instead of making them, see [Suggestions](./suggestions.md).

## The agent and its tools

```ts
import { createDocumentAgent, createAgentTools } from '@dotvoid/textbit-agent'

const agent = createDocumentAgent(editor, { plugins })
const tools = createAgentTools(agent)
```

`editor` is a live editor (from `useEditor()` inside `Textbit.Root`) or one from
`createTextbitEditor`. `plugins` must be the plugins the editor was made with: they decide what
the document may hold, and the agent checks every edit against them.

`createAgentTools` returns four tools, named with a prefix, `document_` by default:

| Tool | Does |
|------|------|
| `document_read` | The document, or a page of it, with its revision |
| `document_search` | The text elements containing a text, case ignored |
| `document_types` | The element types, their properties and children, marks and inline elements |
| `document_edit` | A batch of changes, applied together or not at all. Not offered when read-only. |

Each tool is a plain object: `name`, `description`, `inputSchema` (JSON Schema), `handler`
(takes the parsed input, returns plain data) and `toText` (the result as text for the model).
`createAgentTools(agent, { prefix: 'article_' })` gives `article_read` and so on, for an agent
that works on more than one document.

The same is available without tools, on the agent itself:

| Method | Returns |
|--------|---------|
| `agent.read({ from?, limit? })` | `{ revision, view, total, next? }` |
| `agent.search({ query, limit? })` | `{ revision, matches: [{ line, in? }] }`; `limit` defaults to 20 |
| `agent.describe()` | The element types as text, as `document_types` gives them |
| `agent.edit({ operations, revision?, opId? })` | An edit result, see below |
| `agent.startRun()` | A run, see [Runs](#runs) |

`describeSchema(getSchema(plugins))` gives the same text as `agent.describe()` without an
agent.

## What the agent reads

The document as one element per line, children indented two spaces under their parent:

```
[#a1b2c3 text role="heading-1"] A harbour town
[#d4e5f6 text] Some [bold words]{bold} and [a link]{link href="https://example.com" #c7c8c9}.
[#0f0f0f image src="https://example.com/a.png"]
  [#11aa22 content]
  [#33bb44 alt] Hills above the harbour
  [#55cc66 caption] The harbour in January
[#99ee00 acme/factbox unknown] "Its text, which cannot be edited"
```

- **The header,** in brackets: `#` and the element's handle, its type, and its properties.
  Strings are in double quotes, numbers and `true`/`false` are bare.
- **Text** follows the header. `[text]{bold italic}` is marked text; `[text]{link href="…"}` is
  an inline element. In text, `\[`, `\]` and `\\` stand for those characters and `\n` for a
  line break.
- **Short names.** A type or mark is named by the last part of its full name: `image` for
  `base/image`, `caption` for the caption inside an image, `bold` for `base/bold`. When two
  would share a short name, both keep their full name. Full names are always understood.
- **Handles** are the start of an element's id, six characters or more, as many as it takes to
  tell it from every other id. They need no state, so they stay the same from one request to
  the next. Any unique start of an id, at least four characters, is understood, and so is the
  whole id.
- **Elements without a usable id** are named by their path, such as `@3.1`: a text element
  without an id, or an element whose id another element has too. A path changes when blocks
  before it move. An edit to such an element gives it an id of its own.
- **Unknown elements,** whose plugin this editor does not have, show their type, `unknown` and
  their text.

A read returns at most `pageSize` characters (24000 by default) and says where the next page
starts. While the agent suggests, it reads the fork: the document with the suggestions made so
far.

The exact grammar is in [Formats](./formats.md#the-agents-line-format). `FORMAT_GUIDE` is the
same explanation written for a model; `document_read` carries it in its description.

## What the agent changes

`document_edit` takes a list of operations, an optional `revision` and an optional `opId`.
Elements are named by their handle; new content is written in the line format, without
handles.

| Operation | Fields | Does |
|-----------|--------|------|
| `replace` | `id`, `content` | Replaces an element. One element in place of one keeps its handle. |
| `insert` | `content`, and `after`, `before` or `into` | Inserts content after or before an element, last inside one, or, with none of them, at the end |
| `delete` | `id` | Deletes an element |
| `move` | `id`, and `after`, `before` or `into` | Moves an element |
| `setProperties` | `id`, `properties` | Sets properties; `null` removes one |
| `replaceText` | `id`, `find`, `replace`, `all` | Replaces text within an element, keeping its marks. `find` must occur once, unless `all` is set. |

```ts
agent.edit({
  revision,
  operations: [
    { op: 'replaceText', id: 'd4e5f6', find: 'teh', replace: 'the' },
    { op: 'insert', after: 'd4e5f6', content: '[text] A new paragraph.' },
    { op: 'insert', content: '[image src="https://example.com/b.png"]\n  [caption] The pier' }
  ]
})
```

The editor adds required children content leaves out: `[image src="…"]` alone gets its
content, alt text and caption.

**All or nothing.** A batch runs on a copy of the document first. Only if every operation works
and the result keeps the document valid (see [Schema and validation](./schema-and-validation.md))
does it run on the editor, as one change. Otherwise nothing changes.

**The result.** On success: `{ ok: true, revision, view }`, where `view` holds the changed
top-level elements in the line format, new handles included. On failure:
`{ ok: false, revision, error, view? }`. `error` has a `code`, a `message`, the index of the
`operation` it concerns where there is one, a `hint` where there is something to say, and, for
`invalid-content`, the `issues` found.

| Code | Means |
|------|-------|
| `not-found`, `ambiguous-id` | A handle names no element, or more than one; the message lists the handles to use |
| `parse-error` | The content is not in the format; the message says on which line and what would be right |
| `invalid-operation` | An operation is missing a field or cannot be done |
| `text-not-found`, `text-ambiguous` | `replaceText` finds the text nowhere, or more than once |
| `invalid-content` | The result would break the document's rules; `issues` says how |
| `not-allowed` | The operation would change or remove an unknown element, or the agent is to suggest without a fork to suggest in |
| `stale` | Someone changed an element the batch changes since the given revision; `view` has it as it is now |
| `read-only` | The agent may only read |

The messages are written for a model to act on, and the tools' `toText` puts them first, so a
model can read the error, correct itself and try again.

### Revisions

Every read and search returns a `revision`. An edit that passes one is refused with `stale`
only if an element it changes was changed by someone else since: typing elsewhere in the
document does not stop it. What each element looked like is kept in memory with the editor,
for the last 32 revisions; an edit against a revision this process did not hand out is refused
if anything in the document changed. Without a revision, an edit applies to the document as it
is.

### Retries

An edit with an `opId` that was already applied returns the same result and changes nothing.
The last 100 are remembered.

## Unknown elements

Elements whose plugin the editor lacks are kept as they are. An agent may move them, but not
change, convert or remove them, nor anything containing them: those are decisions for people.
`unknownElements: 'all'` lifts this, for hosts that trust their agents with them.

## Read-only

`readOnly: true` refuses every edit with `read-only`, and `createAgentTools` leaves out
`document_edit`.

## What people see

In a shared document, give the agent a presence (see
[Agents on a server](./agents-server.md#presence)). Editors then show what it does:

- **Its status,** for hosts to show: `reading`, `thinking`, `idle`. `useAgents()` gives the
  agents in the document, for a status line or an announcement.
- **What it changed, in the text.** Added text is tinted in the agent's colour, removed text is
  struck through where it was, and the agent's name sits above its first change in each block.
  Nothing is locked: people can keep typing there.
- **The marks fade** after 8 seconds (`agentChangeDuration` on `Textbit.Root`), counted from
  when each person's editor first shows them and only while the page is visible. They go
  sooner when someone edits the marked text, when the agent starts its next run or undoes the
  run.
- **Screen readers** hear each change once, as a sentence such as "Writing assistant changed
  “teh” to “the”". The marks themselves are hidden from them and left out of copies.

An edit is made at once, so an agent is never shown as `writing` in a block for long, which
would read as "wait". The `writing` marker, a thin bar at the block's edge, is for an agent
that writes over time.

## Runs

A task an agent carries out, from the request to its last edit, is a run:

```ts
const run = agent.startRun()
// the model calls the tools
run.finish()

// the person does not like it
run.undo()   // { ok: true } or { ok: false, message }
```

`run.undo()` undoes every edit of the run as one. In a shared document it does so the way
Y.js undoes: what others wrote in the meantime stays, even in the same paragraph. In a
document that is not shared, it works while nobody else changed the document, and says so
otherwise.

In a shared document, agent edits reach Y.js under an origin of their own. The undo of the
person at the same editor never undoes them; only the run does. `run.edits` counts the batches
applied.

A new run clears what the last one published as changes; an undone run clears its own.

## Apply or suggest

`review: 'apply'`, the default, makes edits. `review: 'suggest'` makes them in `suggestIn`, an
editor on the fork of the document, where they are suggestions for people to accept or reject,
change by change. The document itself does not change. See [Suggestions](./suggestions.md).

- **Apply** when the person who asked is the one reviewing, the change is easy to see and to
  undo, or the agent works on its own text: fixing spelling, tidying, filling in.
- **Suggest** when others must agree, the document is shared and published from, or the change
  is large: rewrites, deletions, new sections.

The option can change while the agent runs (`agent.context.options.review`). Rebuild the tools
with `createAgentTools` then, so the edit tool's description follows.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `plugins` | core's text block | The editor's plugins |
| `readOnly` | `false` | Offer reading only |
| `unknownElements` | `'move'` | `'all'` lets agents change and remove unknown elements |
| `pageSize` | `24000` | Characters a read returns at most before it pages |
| `presence` | none | From `createAgentPresence`, to show people what the agent does |
| `review` | `'apply'` | `'suggest'` proposes changes for people to accept or reject instead |
| `author` | the presence's name, else `Agent` | Who suggestions are from: `{ name, color }` |
