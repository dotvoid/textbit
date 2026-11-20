# Formats

What textbit stores in documents and sends between peers and to models, specified precisely
enough to read or write it without textbit: from another language, or a peer of your own.
Everything here is part of the 3.0 API and changes only by addition.

**Versions.** None of these formats carries a version field in 3.0. A reader takes data
without one as version 1. A later format that is not a pure addition adds a `version` field,
so a reader can tell it apart.

## Documents

A document is an array of top-level elements, as Slate holds it. In a shared document it is a
text field of a Y.js 14 document, laid out as in [Shared documents](#shared-documents).

**An element:**

| Field | Type | |
|-------|------|---|
| `id` | string | Unique in the document. Required on every element except those of class `text`, where it is optional, though the editor gives every element it creates one. |
| `type` | string | `<namespace>/<name>`, e.g. `base/image`; a child's type is its parent's followed by its own, e.g. `base/image/caption` |
| `class` | `text`, `block`, `void` or `inline` | What the element is |
| `properties` | object of strings, numbers and booleans | What its plugin stores; optional |
| `lang` | string | The element's language, when not the document's; optional |
| `children` | array | Elements, or text nodes |

**A text node:** `{ "text": "…" }`, and for each mark it carries, the mark's name set to
`true`, e.g. `{ "text": "bold", "base/bold": true }`.

**Classes.**

- `text` holds text nodes and inline elements, unless its plugin declares child types; then it
  holds those (a list is `text` and holds list items).
- `block` holds elements: its declared children.
- `void` holds a single empty text node, `[{ "text": "" }]`, and shows something else, such as
  an image.
- `inline` sits in text, between text nodes, and holds text nodes.

An element whose type no plugin in an editor registers is kept as it is, untouched, and shown
as an object whose plugin is missing.

### The plugins' elements

What `@dotvoid/textbit-plugins` stores. Child counts are what the editor keeps: `exactly 1`
fields always exist.

| Type | Class | Properties | Children |
|------|-------|------------|----------|
| `base/text` | text | `role`: `heading-1` to `heading-6` or `preamble`; none for a paragraph | text |
| `base/unordered-list`, `base/ordered-list` | text | | `…/list-item` (text), any number |
| `base/code-block` | block | | `base/code-block/body` (text), exactly 1 |
| `base/blockquote` | block | | `body` (text), exactly 1; `citation` (text), exactly 1 |
| `base/table` | block | | `base/table/row` (block), each holding `base/table/row/cell` (text) |
| `base/image` | block | `src` (string, required), `width`, `height` (numbers) | `content` (void), `alt` (text), `caption` (text), each exactly 1, in that order |
| `base/audio` | block | `src` (string, required), `title` (string) | `content` (void), `caption` (text), each exactly 1 |
| `base/link` | inline | `href` (string, required): http, https, mailto or tel | text |

Marks: `base/bold`, `base/italic`, `base/underline`, `base/strikethrough`, `base/code`.

Core's own paragraph is `base/text` without properties. For any editor, `getSchema(plugins)`
and `toJsonSchema` give this as data; see [Schema and validation](./schema-and-validation.md).

### Shared documents

A **text field** is a `Y.Node` of a Y.js 14 document whose children are the document's
top-level elements, in order. `seedField` writes one and `fieldToValue` reads one.

- **An element** is a node without a name. Its `id`, `type`, `class` and `lang` are attributes
  of the same names, and each of its properties is an attribute of its own, `p:` and the
  property's name: `properties.src` is `p:src`. Two people changing different properties at once
  therefore keep both changes. The type being an attribute, changing it keeps the element, and
  what is anchored in it.
- **Its children** are the node's children: text as formatted text, and elements as child
  nodes. Inline elements are child nodes between the runs of text.
- **A mark** is a format on the text, by the mark's name, set to `true`. Marks whose name starts
  with `_`, such as `_suggested`, are only shown in the editor and never stored.
- **Empty text** is not stored. A `void` element's node has no children.

Documents written by textbit 2 keep all of an element's properties in one `properties`
attribute. They load as they are, and a property changed by textbit 3 moves to its own
attribute.

## Suggestions

Suggestions are a fork of the shared text, as Y.js 14 makes them: a `Y.Doc` of their own
(`gc: false`, `isSuggestionDoc: true`) that starts as a copy of the text's and keeps receiving
everything the text gets. What is suggested is what the fork has and the text has not, or has
deleted in the fork: Y.js's `createDiffRenderer(text, fork)` shows it. Nothing about suggestions
is stored in the text itself. Accepting writes the suggested items into the text; rejecting
deletes them in the fork and writes them into the text already deleted. With y-quorum, the fork
is the document's `suggestions` layer. See [Suggestions](./suggestions.md).

## hashNode

A hash of an element that every peer computes alike, `hashNode` in core:

1. **Canonical JSON** of the element: objects with their keys sorted (by UTF-16 code unit,
   as JavaScript's default sort does), keys whose value is `undefined` left out, a
   `properties` key whose value is an empty object left out too (a shared document cannot
   tell it from none), arrays in order, strings, numbers, booleans and `null` as
   `JSON.stringify` writes them. No spaces.
2. **FNV-1a, 32 bits,** over the UTF-16 code units of that string: start at `0x811c9dc5`; for
   each code unit, XOR it in, then multiply by `0x01000193` modulo 2³².
3. The result as an **unsigned integer in base 36**, lowercase.

The keys are sorted because peers may hold an element's properties in different orders.

## Agent presence

An agent says what it does in its Y.js awareness state, in the field `textbitAgent`
(`AGENT_PRESENCE_FIELD`). `null`, or no field, means no agent.

| Field | Type | |
|-------|------|---|
| `name` | string | Shown to people |
| `color` | string | A CSS colour; optional |
| `status` | `thinking`, `reading`, `writing` or `idle` | What it does now |
| `blocks` | string[] | Ids of the top-level elements it works on; always empty when `idle`. Editors mark them while the status is `writing`. |
| `changes` | array | What it changed in its current or last run, at most the 50 latest; optional |

**A change:**

| Field | Type | |
|-------|------|---|
| `id` | string | Unique |
| `block` | string | Id of the top-level element it is in |
| `from`, `to` | number[] | The start and end of the added text, each the bytes of `Y.encodeRelativePosition` of a relative position in the text field, as `pointToRelativePosition` makes them; equal for a removal |
| `added` | string | The text added; optional |
| `removed` | string | The text removed; optional |

An editor shows a change while the text between `from` and `to` still equals `added`.

## Cursors

A person's cursor is in their Y.js awareness state, in two fields, named by the editor's
`cursor` option:

| Field | Default name | Type | |
|-------|--------------|------|---|
| position | `selection` | `{ anchor, focus }` or `null` | Each the bytes of `Y.encodeRelativePosition` of a relative position in the text field, as a number array, as `pointToRelativePosition` makes them. `null` when the editor has no selection. |
| data | `data` | object | What others see: `name` and `color` label the cursor |

An editor sends its cursor only while it is in use, and shows the others' cursors that are in
its own text field.

## The agent's line format

What `document_read` returns and what `document_edit` content is written in.

**Lines.** One element per line. A child is on the lines after its parent, indented two spaces
more. Blank lines are ignored. Content to insert may start at any indentation; its first line
sets the base.

**A line** is a header, then, for an element that holds text, a single space and its text.

**The header** is `[`, tokens separated by spaces, `]`:

1. `#` and the element's handle; only when reading, or to name an existing element.
2. The element's type: its short name, or its full name.
3. Its properties, each `name=value`. A string value is a JSON string in double quotes; a
   number or `true`/`false` is written bare.
4. `unknown`, when reading an element whose plugin the editor lacks. Written content cannot
   contain it.

Inside quotes, `]` does not end the header.

**Short names.** A top-level or inline type, or a mark, is named by the part after its last
`/`, unless two of them would share it; then both keep their full name. A child type is named
by its own part, `caption` for `base/image/caption`, within its parent. Full names are always
accepted.

**Handles.** The shortest start of the element's id, at least six characters (or the whole id
when shorter), that no other id in the document starts with. An element without an id, or
whose id another element has too, is `@` and its path, the indexes joined by `.`, such as
`@3.1`. Reading back, a handle is understood when it is a whole id, a start of exactly one id of
at least four characters, or a path.

**Text.**

- `\\`, `\[` and `\]` stand for `\`, `[` and `]`; `\n` for a line break; `\` before any other
  character for that character.
- `[text]{marks}`: the text with each mark, by name, separated by spaces. The text inside is
  plain text with the same escapes.
- `[content]{type properties #handle}`: an inline element. The first token is an inline type;
  `content` is text and marked text. `#handle` appears when reading and is ignored when writing.
  `unknown` follows when its plugin is missing.
- Text without marks is written as it is. A text node with no text is not written.

**An element whose plugin is missing**, when reading: its header with `unknown`, then its text
as a JSON string, cut at 200 characters with `…`.

### Tools

| Name | Input | Result |
|------|-------|--------|
| `document_read` | `from?` (handle), `limit?` (integer ≥ 1) | `{ revision, view, total, next? }` |
| `document_search` | `query`, `limit?` | `{ revision, matches: [{ line, in? }] }` |
| `document_types` | none | `{ types }`, a description of the element types |
| `document_edit` | `operations`, `revision?`, `opId?` | `{ ok: true, revision, view }` or `{ ok: false, revision, error, view? }` |

The prefix `document_` is the default of `createAgentTools`. Operations: `replace`, `insert`,
`delete`, `move`, `setProperties`, `replaceText`; error codes: `read-only`, `not-found`,
`ambiguous-id`, `invalid-operation`, `parse-error`, `not-allowed`, `text-not-found`,
`text-ambiguous`, `invalid-content`, `stale`. See [Agents](./agents.md#what-the-agent-changes)
for what each means.

The tools' descriptions, `FORMAT_GUIDE` and the texts `toText` makes are written for models.
Their wording may improve in any release; the names, fields and codes above do not change.
