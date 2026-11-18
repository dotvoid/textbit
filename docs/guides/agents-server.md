# Agents on a server

The usual setup for an agent in a shared document: people edit in their browsers, the
document is shared through a Y.js collaboration server, and the agent runs on a server too,
joined to the same document as a peer of its own. Its edits then reach everyone as they are
made, with its name on them, and nobody waits for anybody.

This guide uses Hocuspocus as the collaboration server and its provider to join it. Any Y.js
provider works the same way: the agent needs the document's `Y.Doc` and the provider's
awareness. For collaboration in general, see [Collaboration](./collaboration.md).

```bash
npm install @dotvoid/textbit @dotvoid/textbit-plugins @dotvoid/textbit-agent \
  @hocuspocus/provider @slate-yjs/core slate yjs
```

## Joining the document

```ts
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { YjsEditor } from '@slate-yjs/core'
import type { Editor } from 'slate'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Italic, Link, Image } from '@dotvoid/textbit-plugins/definitions'

// The same plugins, with the same options, as the editors in the document
const plugins = [Text({ headings: [1, 2] }), Bold(), Italic(), Link(), Image()]

const ydoc = new Y.Doc()
const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: 'article-123',
  document: ydoc,
  token: process.env.DOCUMENT_TOKEN ?? ''
})

// Until the provider has synced, the document is empty
await new Promise<void>((resolve) => provider.on('synced', () => resolve()))

const editor = createTextbitEditor({ plugins, shared: ydoc.get('content', Y.XmlText) })
YjsEditor.connect(editor as YjsEditor & Editor)
```

- **Node 22 or later** has `WebSocket` built in, which the provider uses.
- **`@dotvoid/textbit/headless` and `@dotvoid/textbit-plugins/definitions`** load no React. The
  definitions have the same names and options as the plugins the browsers use, without their
  views.
- **The shared type's name,** `content` here, must be the one the browsers use for
  `Textbit.Root`'s `value`.
- **Wait for `synced`.** An agent that reads before then sees an empty document.
- **`YjsEditor.disconnect(editor)` and `provider.destroy()`** when the agent leaves.

Anything a server writes to a shared document should go through such an editor rather than
into the Y.js types directly: the editor repairs what it writes, by the plugins' rules, before
it reaches the others. See [Without a user interface](./headless.md).

## The agent

```ts
import { createAgentPresence, createAgentTools, createDocumentAgent } from '@dotvoid/textbit-agent'

const presence = createAgentPresence(provider.awareness!, { name: 'Writing assistant', color: '#7c3aed' })
const agent = createDocumentAgent(editor, { plugins, presence })
const tools = createAgentTools(agent)
```

Serve `tools` to a model as in [Agents over MCP](./agents-mcp.md).

## Presence

The presence uses the awareness of the agent's own connection, so the people in the document
see the agent as a participant. The agent keeps it up to date:

- `reading` while it reads or searches;
- `thinking` during a run otherwise, and right after an edit, which is made at once;
- `idle` when a run ends;
- and, after each edit, what it changed in the text, word by word, placed with Y.js relative
  positions so the marks follow the text while people keep typing.

Editors show the changes for a moment, with the agent's name, then fade them; see
[Agents](./agents.md#what-people-see). `presence.set(status, blocks?)` says something else,
`presence.clear()` leaves. Clear it when the agent stops, so its name does not linger until the
awareness times out.

The fields are specified in [Formats](./formats.md#agent-presence).

## Runs

A run is one task, from the request to the agent's last edit. Its edits can be undone as one,
and the agent shows as `thinking` from start to finish.

```ts
const run = agent.startRun()
// the model works
run.finish()

// later, if a person asks
const result = run.undo()   // { ok: true } or { ok: false, message }
```

In a shared document the undo is Y.js's: it takes back exactly the run's edits, and what people
wrote meanwhile stays, even in the same paragraph. A run started later does not affect an
earlier one's undo.

**Where a run ends** is for the host to decide, as only the host knows what a task is:

- In your own model loop, a task ends when the model answers without calling a tool. Finish
  the run there.
- Behind an MCP server, the server only sees separate tool calls. A pause between them is a
  practical end: start a run at the first call after a pause, and finish it when no call has
  come for, say, 20 seconds. The agent lab in this repository does this.

To offer "Undo the assistant's last change" to the people in the document, keep the last run
and let them ask for its undo, for example through a value in a `Y.Map` of the same document
that the agent's server observes.

## Edit or suggest

`createDocumentAgent(editor, { plugins, presence, review: 'suggest' })` makes the agent propose
its changes instead, for people to accept or reject in their editors. See
[Suggestions](./suggestions.md).

## Starting over without old copies

A Y.js peer keeps its copy of a document, and merges it in when it connects again. That is what
makes offline editing work, and it has a consequence for any server that can throw a document
away and start it again, for example a test server that seeds a fresh document on start. A
browser tab or agent that still holds the old copy reconnects, and the two copies merge: every
element twice, with the same ids. Editors take out exact copies, but copies someone edited stay.

So give each incarnation of a document a name of its own, and turn away clients that ask for an
old one. The agent lab does this: the server names the document `lab-<time it was created>`,
hands the name out over HTTP, and refuses any other in `onAuthenticate`. Clients that are turned
away ask for the current name and start from a new, empty `Y.Doc`.
