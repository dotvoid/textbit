# What's new in 3.0

Textbit 3 is about people and agents writing one document together. An AI agent reads and edits
the document the way a person does, within the same rules, and people see what it does, take
it back or decide on what it proposes. Underneath, shared editing moves to Y.js 14 with a
binding of textbit's own, and a server joins the family: y-quorum, which holds everyone to their
role and keeps an account of every change.

Textbit 3.0 is released when Y.js 14.0 is. Until then it is built against a pinned release
candidate, `@y/y` 14.0.0-rc.30, and checked again at each new one.

| Package | Version |
|---|---|
| `@dotvoid/textbit` | 3.0.0 |
| `@dotvoid/textbit-plugins` | 1.0.0 |
| `@dotvoid/textbit-styles` | 1.0.0 |
| `@dotvoid/textbit-agent` | 1.0.0, new |
| `@dotvoid/y-quorum` | new: the server |
| `@dotvoid/y-quorum-client` | new: its client |

Coming from 2.x? Read [Upgrading from 2.x](./upgrading-from-2.md).

## Agents in the document

`@dotvoid/textbit-agent` gives an agent one editor's document as four tools: read, search, the
element types, and edit. It owns no model and no framework: you run the model, and the package
turns its tool calls into ordinary editor changes. See [Agents](./agents.md).

- **A format made for models.** The agent reads the document as one element per line, with
  short handles in place of ids, and writes new content in the same format.
- **Checked like a person's edits.** A batch of changes runs on a copy first, and applies only
  if every operation works and the document stays valid. Otherwise nothing changes.
- **Errors that teach.** A refused edit says why, on which operation, and what would work, so
  the model can correct itself and try again.
- **Never in anyone's way.** An edit is refused as stale only if someone changed the same
  element since the agent read it. Typing elsewhere does not stop it.
- **Unknown content is left alone.** Elements whose plugin is missing can be moved, never
  changed or removed, unless the host allows it.
- **Any framework.** Each tool is a plain object with a JSON Schema, served over MCP or handed to
  a model SDK in a few lines. See [Agents over MCP](./agents-mcp.md).

### What people see

- **Presence.** An agent in a shared document has a name and colour, and a status: reading,
  thinking or idle. `useAgents()` gives the agents present, for a status line.
- **Its changes, in the text.** Added text is tinted in the agent's colour, removed text struck
  through where it was, and the agent's name sits above its first change in each block. The
  marks fade after 8 seconds (`agentChangeDuration`). Nothing is locked.
- **Said to screen readers,** once each, as a sentence: "Writing assistant changed “teh” to
  “the”".

### Runs

A task an agent carries out is a run. `run.undo()` takes back every edit of the run as one, and
in a shared document leaves what people wrote in the meantime, even in the same paragraph. A
person's own undo never undoes an agent's work.

### On a server

An agent can work on a headless editor on a server, joined to the shared document as a peer of
its own, so people see its edits as they are made. See [Agents on a server](./agents-server.md).

## Without a user interface

- **`createTextbitEditor`** is the editor without React or a browser: the same document, rules
  and commands, on a server, in a script or in an agent's tools. It is in
  `@dotvoid/textbit/headless`. See [Without a user interface](./headless.md).
- **Plugins are a definition and a view.** The definition holds the elements, rules and actions,
  and runs anywhere. The view holds the components and tools. The ready-made plugins' definitions
  are in `@dotvoid/textbit-plugins/definitions`.
- **Schemas.** Plugins describe their elements and properties. `getSchema`, `validate` and
  `toJsonSchema` check a document, or describe it to a model, without changing it. See
  [Schema and validation](./schema-and-validation.md).

## Y.js 14, with textbit's own binding

Shared editing moves from Y.js 13 and slate-yjs to Y.js 14 and a binding written for textbit.

- **Text fields.** The editor binds to a text field: any `Y.Node` holding blocks, in a document
  that may hold much else.
- **Properties apart.** Each property of an element is kept on its own, so two people changing
  different properties at once both keep their change.
- **The type is an attribute.** Turning a paragraph into a heading keeps the element, and what
  is anchored in it, such as comments.
- **No drift.** An editor follows others by reading the blocks a change touched from Y.js and
  comparing, never by replaying the change, so it cannot drift from the shared document.
- **Several editors on one field** in one page stay in step, each with its own undo.
- **Cursors** are Y.js relative positions, which follow everyone's typing.
- **2.x documents load as they are.** See
  [Upgrading from 2.x](./upgrading-from-2.md#documents-stored-by-2x).

## Comments

Threads on a range of text, kept beside the document, never in it. Give `Textbit.Root` a comment
store and the editor finds each thread's text and highlights it; `useComments()` gives the rest
for a panel of your own. A thread is anchored two ways: by Y.js relative positions in a shared
editor, and by its quote, so a document restored from JSON finds its comments again. A thread
whose text is gone is detached, never moved to other text. `createCommentStore` is for hosts
that save comments themselves; with y-quorum the server keeps them and decides who may do what.
See [The editor](./the-editor.md#comments).

## Suggestions

Changes proposed for people to accept or reject, made the way Y.js 14 does: in a fork of the
shared text. See [Suggestions](./suggestions.md).

- **People suggest** by typing in suggesting mode. Suggested text can be edited like any other.
  Out of it, they edit as usual and see what others suggest around them.
- **Agents suggest** by editing the fork, with `review: 'suggest'`. Moves included.
- **Everyone sees** what would be added underlined and what would be removed struck through,
  with who suggested it.
- **`Textbit.Suggestions`** lists the changes in the order of the text, with Accept and Reject,
  and Accept all and Reject all. It is how keyboard and screen reader users review.
- **Taking back an agent's work** is a suggestion too: y-quorum suggests the inverse of a run, an
  actor's changes or a stretch of time, for a person to accept change by change.

## y-quorum

A server for documents people and agents write together, with its client, both on Y.js 14. One
process and a SQLite file run everything. See [y-quorum](./y-quorum.md) and
[The y-quorum client](./y-quorum-client.md).

- **Typed documents.** A document type describes a tree of fields: strings, numbers, dates,
  choices, objects, keyed lists, and text fields that textbit edits. Rich text is one kind of
  field among them.
- **Many documents and views.** One connection holds many documents open, and the same text
  field may be in several editors at once.
- **Rights held by the server.** Every change has an actor, fixed when a connection
  authenticates, never taken from what a client says about itself. Roles such as reader,
  commenter, suggester, editor and owner decide who may write, comment, suggest, accept and
  reject, and the server refuses what a role does not allow.
- **Who wrote what.** The server keeps attributions of every change, by person, agent, on whose
  behalf and in which run. Editors can show them in the text.
- **Versions.** Save a version, compare any two, go back to any point in time, and restore one
  as a new change in the restorer's name. History is never rewritten.
- **A history that can be checked.** Changes are grouped into history entries, each chained to
  the one before by a SHA-256 hash. Given a key, the server signs the head at checkpoints and
  versions. `exportHistory` gives the chain as JSON Lines, and `verifyHistory` checks it
  on its own, with or without the changes' contents.
- **Review evidence.** A person marks an agent's run, or all agent text as it is, reviewed: an
  entry in the chain. `unreviewed()` lists agent text not reviewed since, for a check before
  publishing.
- **Agents over MCP.** `@dotvoid/y-quorum/mcp` serves tools for documents, plain fields, text
  fields, suggestions and comments to MCP clients over HTTP. An agent's rights are never more
  than those of the person it acts for, and a document can narrow what agents may do there.
- **Storage** in memory, SQLite, Postgres and S3, or a host's own store that keeps documents as
  JSON. Old log and history contents can be pruned; the chain and the versions stay.
- **More than one node.** Each document is held by one node at a time, under a lease. The other
  nodes pass its traffic on, and take it over when its node shuts down or stops renewing.

## Accessibility

- **Agents' changes and new suggestions are announced** from a polite live region, in sentences
  hosts can translate.
- **Suggestions can be reviewed from the keyboard** and with screen readers, through
  `Textbit.Suggestions`.
- **What is drawn for the eye,** such as agents' names and struck text, is hidden from screen
  readers and left out of copies.
- **An icon-only menu trigger can be named,** and the upload announcer stays where screen
  readers hear it.
- **Shift+Arrow onto or out of an object selects it** at once. Up and Down with Shift, Alt, Cmd
  or Ctrl are left to the browser, and shortcuts such as undo, find and zoom work while objects
  are selected.
- A guide, [Accessibility](./accessibility.md), says what textbit does and what is left to the
  host.

## Other improvements

- **Tables from the context menu.** Plugins can add actions to the context menu, and the table
  uses it for its rows and columns, so a table is editable without a menu of your own.
- **Ids stay put in shared documents.** An editor no longer rewrites the ids of what arrives
  from others, which made copies disagree.
- **On a server.** The editor and the plugin definitions load without a browser.
- **Packaging.** ES modules and CommonJS, with declarations that TypeScript finds under
  `NodeNext` module resolution.
- **Copy and drag fixes.** A partly copied list inside an object pastes as a paragraph per item.
  A drag across an object's text no longer selects the object.
- **Documentation.** Guides from a first editor to agents, the stored and sent formats written
  down as specifications, and an API reference generated from the code.

## Breaking

The details, with before and after, are in [Upgrading from 2.x](./upgrading-from-2.md).

- **Plugins** are a definition (`element`) and a view (`view`); `componentEntry`, `events` and
  an action's `tool` move or go.
- **Types** carry the `TB` prefix; `TBPlugin` is a plugin with its view.
- **Actions** get `consumeFiles` in place of `api`, and a narrower `event`.
- **Shared documents** use Y.js 14 text fields and textbit's binding, in place of Y.js 13,
  `Y.XmlText` and slate-yjs. Providers built on Y.js 13, Hocuspocus among them, no longer fit.
- **2.x and 3.x cannot edit one document at once.** Move every user of a document together.
  Stored documents load as they are.
- **Repairs.** An editor repairs only its own changes, no longer what arrives from others.
  What two people's changes break between them is repaired once, by the document's owner:
  `repairField`, which y-quorum's server calls for you.
- **Packaging.** The UMD build is gone, and the files are renamed.

## Not yet

What the 3.0 work has left open, to come in later releases:

- **Suggestions.** Accepting one person's change can take a neighbouring person's along, as Y.js
  decides a whole run of touching changes at once. Changes to a block's properties alone are not
  listed. There is one fork per document, not one per person.
- **Decisions and undo.** Accepting or rejecting a suggestion is not in the person's undo.
- **History.** Reviewing a range rather than a run; filtering differences by person or run;
  scrubbing comments in step with the content; an export as W3C PROV.
- **The MCP module.** Tools for history, review and taking back a run; runs named in an agent's
  claim, so history groups an agent's work by run; resources, prompts and subscriptions;
  confirming edits through elicitation; OAuth helpers; revisions that survive the connection
  closing.
- **Hosts and clients.** Outside changes to a host's JSON merged into a live document; local
  copies in IndexedDB; the client giving up documents it has not used in a while; an HTTP API
  for writers in other processes; comment events and mentions.
- **More than one node.** Presence per namespace sees only the node a follower is on. A node
  whose storage stalls while its network lives keeps taking traffic, and its documents hang until
  it restarts. After a token is renewed, traffic passed on to other nodes keeps the
  authentication it began with.
