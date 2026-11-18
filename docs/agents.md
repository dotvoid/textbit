# Textbit 3: agents in the document

Status: planned major release, built on the `v3` branch.

Agents should be able to read and edit a textbit document the way people do: in the same
document, live, within the same rules, and with people able to see and review what they
do. Textbit is a library used in many different ways, with and without Y.js, read-only or
not, with different plugins per editor. It owns no server, no model calls and no auth. So
it ships the parts that only the editor can get right, and leaves transport and policy to
the host.

## Principles

- **Agents never write raw data.** They call a few tools that become ordinary editor
  operations, so normalization and plugin rules apply exactly as for people.
- **Address by id, not by position.** Blocks by their id; text inside a block by quoting
  it. Never indexes or offsets.
- **Every read has a revision.** An edit whose target changed since the read is rejected
  with the fresh content, so the agent can retry. Edits elsewhere never block it.
- **Errors teach.** Structured errors with a code, the failing operation, a hint and the
  valid alternatives (allowed types, a property's schema, the nearest text match).
- **Unknown content is opaque.** An object whose plugin is missing is shown as a
  placeholder. Agents may move it but never change, convert or remove it unless the host
  explicitly allows it.
- **Read-only is read-only.** A read-only editor offers agents read tools only.
- **Transport-agnostic.** Tools are plain descriptors (name, description, JSON Schema in
  and out, handler) that a host adapts to MCP, an in-page tool API or an SDK.
- **Free when unused.** Nothing agent-related ends up in a host's bundle unless imported.

## Packages

- `@dotvoid/textbit` (core)
  - A headless entry that runs without React or a DOM, in browsers and Node:
    `createTextbitEditor({ plugins, lang })`, `getSchema(plugins)`, `validate(doc)`.
  - The React entry builds on it.
- `@dotvoid/textbit-plugins`
  - Each plugin split into a definition (data, schema, normalizers; no React) and its
    components. A clean break from 2.x.
- `@dotvoid/textbit-agent` (new)
  - The document view and its parser, operations, revisions, errors and tool descriptors.
  - Presence and review helpers.
  - Helpers for binding a headless editor to a shared Y.js document on a server.

## Schema

An optional `schema` on component entries, so third-party plugins become agent-editable by
describing themselves:

```ts
schema?: {
  description?: string
  properties?: Record<string, {
    type: 'string' | 'number' | 'boolean'
    enum?: (string | number)[]
    required?: boolean
    description?: string
  }>
  marks?: string[] | 'all' | 'none'
  inlines?: string[] | 'all' | 'none'
  topLevel?: boolean
  example?: Descendant
}
```

`getSchema(plugins)` returns JSON Schema plus a short description aimed at models.
`validate(doc)` reports problems without changing anything. Normalizers should read the
schema rather than repeat it, so the two cannot drift.

## The agent's view of a document

A compact text form with one line per block: its id, type and non-default properties,
then its text with marks in a small inline syntax. The same syntax is accepted back.
Object properties are JSON. Child fields of an object are indented under it.

Operations: `replace`, `insertBefore`, `insertAfter`, `delete`, `move`, `setProperties`,
`replaceText` (quoted old and new text inside one block). A batch is atomic by default and
carries an operation id, so a retry does not apply twice.

## Running agents

- **In the page.** Operations go through the live editor, as one undo step per agent run.
  Registration with a browser tool API is optional and feature-detected.
- **On a server.** The headless editor is bound to the shared Y.js document through the
  collaboration server's direct connection. The host owns the server and the model.

## Presence

An awareness field for agents: `role: 'agent'`, a name and colour, a status (`thinking`,
`writing`, `idle`) and the ids of the blocks it works on. Editors show it as a block-level
marker, read-only ones too. It is an advisory lease, never a lock.

## Review

First, a review that lives in one editor: the agent writes into a copy, the difference is
shown as an overlay, and a person accepts or rejects it per block. No suggestion format is
stored in the document, which keeps the move to a future Y.js binding open.

Stored suggestions and who-wrote-what come later, on a Slate binding for Y.js 14, whose
attribution and diff model is built for this.

## Known problems this release fixes first

- Content that reaches the shared document invalid, written outside an editor, is repaired
  by every connected editor on arrival, and repairs that insert add up. Agents and servers
  must therefore write through the headless editor, which repairs before it writes.
- `withUniqueIds` rewrites ids in remote insertions too, so a collision makes the local id
  differ from the shared document.
- Building an editor needs React and a DOM: construction lives in `SlateContainer`,
  `withLang` reads `document` and `navigator`, and some modules import the whole library
  through `main`.
- `@slate-yjs/core` has not been released since 2023. We expect to own the binding.

## Phases

| Phase | Content | Size |
|---|---|---|
| 0 | Fix remote ids, inject `lang`, break the `main` imports, extract `createTextbitEditor` | S |
| 1 | Headless core entry, plugin split, schema, `validate` | M |
| 2 | Agent package: view and parser, operations, errors, revisions, tool descriptors, an eval harness | M |
| 3 | Presence convention, block markers, undo per agent run | M |
| 4 | Review in the editor, accept and reject per block | L |
| 5 | Own Y.js 14 binding, then stored suggestions and attribution | L |

## Evals

A corpus of documents and tasks, measuring the valid-operation rate, retries per task,
tokens per edit, unrelated content left untouched, and survival of a scripted person
typing while the agent works.
