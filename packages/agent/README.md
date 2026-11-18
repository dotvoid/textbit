# @dotvoid/textbit-agent

Tools for AI agents to read and edit [`@dotvoid/textbit`](../textbit) documents, in the same
document as the people writing it, under the same rules.

The package owns no server, no model and no framework. It gives an agent access to one
editor's document, and plain tool descriptors (a name, a description, a JSON Schema and a
handler) that you hand to whatever runs your model: an MCP server, a model SDK, or a tool API
in the page. Nothing in it needs React or a browser.

```bash
npm install @dotvoid/textbit-agent
```

## Quick Start

On a server, with a headless editor connected to the shared document:

```ts
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Link, Image } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent, createAgentTools } from '@dotvoid/textbit-agent'
import { YjsEditor } from '@slate-yjs/core'

const plugins = [Text(), Bold(), Link(), Image()]
const editor = createTextbitEditor({ plugins, shared: ydoc.get('content', Y.XmlText) })
YjsEditor.connect(editor)

const agent = createDocumentAgent(editor, { plugins })
const tools = createAgentTools(agent)
```

In the browser, pass the live editor instead (from `useEditor()` inside `Textbit.Root`), with
the same plugins. Edits then go through the editor like any other change, and the people in the
document see them as they happen.

Give the agent the same plugins as the editor: they decide what the document may hold.

## The Tools

| Tool | Does |
|------|------|
| `document_read` | The document, or a page of it, in the line format below, with its revision |
| `document_search` | Text elements containing a text, case ignored |
| `document_types` | The element types, their properties and children, marks and inline elements |
| `document_edit` | A batch of changes, applied together or not at all. Not offered when read-only. |

Each tool is `{ name, description, inputSchema, handler }`. The input schema is JSON Schema
and the handler takes the parsed input and returns plain data, so adapting them is a few
lines:

```ts
// A model SDK that takes JSON Schema tools
const definitions = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema
}))
const run = (name: string, input: Record<string, unknown>) =>
  tools.find((tool) => tool.name === name)!.handler(input)

// An MCP server lists the same fields as name, description and inputSchema,
// and returns the handler's result as the call's structured content
```

`createAgentTools(agent, { prefix: 'article_' })` names them `article_read` and so on, for an
agent with more than one document.

## The Line Format

An agent reads the document one element per line, with its children indented two spaces
under it:

```
[#a1b2c3 text role="heading-1"] A harbour town
[#d4e5f6 text] Some [bold words]{bold} and [a link]{link href="https://example.com"}.
[#0f0f0f image src="https://example.com/a.png"]
  [#11aa22 content]
  [#33bb44 alt] Hills above the harbour
  [#55cc66 caption] The harbour in January
[#99ee00 acme/factbox unknown] "Its text, which cannot be edited"
```

- **Header:** `#` and the element's handle, its type, and its properties, strings in double
  quotes.
- **Text** follows the header. `[text]{bold italic}` is marked text, and
  `[text]{link href="..."}` an inline element. In text, `\[`, `\]` and `\\` stand for those
  characters and `\n` for a line break.
- **Types and marks** have short names: `image` for `base/image`, `caption` for the image's
  caption, `bold` for `base/bold`. When two plugins would share a short name, both keep their
  full one.
- **Handles** are the start of an element's id, six characters or more, as many as it takes
  to tell it from the others. They need no state, so they stay the same from one request to
  the next. Any unique start of an id, at least four characters, is understood, and so is
  the whole id. An element without an id, which a text element may be, is `@` and its path,
  such as `@3.1`, which changes when blocks before it move.
- **Unknown elements**, whose plugin this editor lacks, show their type, `unknown` and their
  text.

New content is written the same way, without handles. The editor gives new elements ids and
adds the required children content leaves out: `[image src="..."]` alone gets its content,
alt and caption.

`FORMAT_GUIDE` is the same explanation, written for a model; `document_read` carries it in its
description.

## Editing

`document_edit` takes a list of operations, an optional `revision` and an optional `opId`:

| Operation | Fields | Does |
|-----------|--------|------|
| `replace` | `id`, `content` | Replaces an element. One element in place of one keeps its handle. |
| `insert` | `content`, and `after`, `before` or `into` | Inserts content after or before an element, last inside one, or, with none of them, at the end |
| `delete` | `id` | Deletes an element |
| `move` | `id`, and `after`, `before` or `into` | Moves an element |
| `setProperties` | `id`, `properties` | Sets properties; `null` removes one |
| `replaceText` | `id`, `find`, `replace`, `all` | Replaces text within an element, keeping its marks. `find` must occur once, unless `all` is set. |

A batch runs on a copy first. Only if every operation works and the result keeps the document
valid (see `validate` in the editor) does it run on the editor, as one change. On success the
result has the new `revision` and a `view` of the changed top-level elements, new handles
included. On failure nothing changed, and the result has an `error`:

| Code | Means |
|------|-------|
| `not-found`, `ambiguous-id` | A handle names no element, or more than one |
| `parse-error` | The content is not in the format; the message says where and what would be right |
| `invalid-operation` | An operation is missing a field or cannot be done |
| `text-not-found`, `text-ambiguous` | `replaceText` finds the text nowhere, or more than once |
| `invalid-content` | The result would break the schema; `issues` says how |
| `not-allowed` | The operation would change or remove an unknown element |
| `stale` | Someone changed an element the batch changes since the given revision; `view` has it as it is now |
| `read-only` | The agent may only read |

`operation` names the operation the error concerns, by its index, and `hint`, where there is
one, says what to do instead.

### Revisions

Every read and search returns a `revision`. An edit that passes it is refused, with `stale`,
only if one of the elements it changes was changed since by someone else. Typing elsewhere in
the document does not stop it. The record of what each element looked like is kept in memory
with the editor, for the last 32 revisions; an edit against a revision this process did not
hand out is refused if anything in the document changed. Without a revision, an edit is
applied to the document as it is.

### Retries

An edit with an `opId` that was already applied returns the same result and changes nothing,
for the last 100 batches.

## Unknown Elements

Elements whose plugin the editor lacks are kept as they are, here as in the editor. An agent
may move them but not change, convert or remove them, nor anything containing them: that is
for people. `unknownElements: 'all'` lifts this, for hosts that trust their agents with them.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `plugins` | core's text block | The editor's plugins |
| `readOnly` | `false` | Offer reading only |
| `unknownElements` | `'move'` | `'all'` lets agents change and remove unknown elements |
| `pageSize` | `24000` | Characters a read returns at most before it pages |

## Licence

MIT
