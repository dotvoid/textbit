# Agents on a server

The usual setup for an agent in a shared document: people edit in their browsers, the
document is shared through a Y.js 14 collaboration server, and the agent runs on a server too,
joined to the same document as a peer of its own. Its edits then reach everyone as they are
made, with its name on them, and nobody waits for anybody.

This guide uses [y-quorum](./y-quorum.md) as the collaboration server and
[its client](./y-quorum-client.md) to join it. Any Y.js 14 provider works the same way: the
agent needs the document's text field and the provider's awareness. For collaboration in
general, see [Collaboration](./collaboration.md).

```bash
npm install @dotvoid/textbit @dotvoid/textbit-plugins @dotvoid/textbit-agent \
  @dotvoid/y-quorum-client @y/y @y/protocols slate
```

## Joining the document

```ts
import * as Y from '@y/y'
import { createClient } from '@dotvoid/y-quorum-client'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Italic, Link, Image } from '@dotvoid/textbit-plugins/definitions'

// The same plugins, with the same options, as the editors in the document
const plugins = [Text({ headings: [1, 2] }), Bold(), Italic(), Link(), Image()]

const client = createClient({
  url: 'ws://localhost:1234',
  token: process.env.DOCUMENT_TOKEN ?? ''
})
await client.ready
const handle = await client.open('articles', 'article-123')

const body = handle.content.getAttr('body')
if (!(body instanceof Y.Node)) {
  throw new Error('The document has no body')
}
const editor = createTextbitEditor({ plugins, shared: body })
```

- **Node 22 or later** has `WebSocket` built in, which the client uses.
- **`@dotvoid/textbit/headless` and `@dotvoid/textbit-plugins/definitions`** load no React. The
  definitions have the same names and options as the plugins the browsers use, without their
  views.
- **The text field,** `body` here, must be the one the browsers give `Textbit.Root` as `value`.
- **`client.open` resolves once the document has arrived,** so the editor shows it from the
  start. The editor is bound at once: there is nothing to connect.
- **When the agent leaves,** release the editor's binding with `sharedOf(editor)?.release()`,
  then `handle.release()` and `client.close()`.

Anything a server writes to a shared document should go through such an editor rather than
into the Y.js nodes directly: the editor repairs what it writes, by the plugins' rules, before
it reaches the others. See [Without a user interface](./headless.md).

## The agent

```ts
import { createAgentPresence, createAgentTools, createDocumentAgent } from '@dotvoid/textbit-agent'

const presence = createAgentPresence(handle.awareness, { name: 'Writing assistant', color: '#7c3aed' })
const agent = createDocumentAgent(editor, { plugins, presence })
const tools = createAgentTools(agent)
```

Serve `tools` to a model as in [Agents over MCP](./agents-mcp.md).

The agent's token decides who it is to the server. With a token of its own, it is a
participant like any other, and the history names it. Working through a person's connection
instead, it gives its changes an origin that claims them as the agent's:

```ts
const origin = handle.claimOrigin({ agent: 'assistant', name: 'Writing assistant' })
const agent = createDocumentAgent(editor, { plugins, presence, origin })
```

The server then records the changes as the agent's, made for the person.

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
and let them ask for its undo, for example through a record appended to the document
(y-quorum's `handle.appendRecord`) that the agent's server watches for. With y-quorum's history,
`handle.suggestRevert({ run })` instead suggests taking a run back, for people to accept; see
[Suggestions](./suggestions.md#taking-back-an-agents-work).

## Edit or suggest

To have the agent propose its changes instead, give it an editor on the fork of the document,
plainly, without a renderer, and `review: 'suggest'`:

```ts
const forkBody = handle.suggestionsDoc.get('content').getAttr('body')
if (!(forkBody instanceof Y.Node)) {
  throw new Error('The document has no suggestions')
}
const forkEditor = createTextbitEditor({ plugins, shared: forkBody })
const agent = createDocumentAgent(editor, { plugins, presence, review: 'suggest', suggestIn: forkEditor })
```

What it changes in the fork, people accept or reject in their editors. See
[Suggestions](./suggestions.md).

## Starting over without old copies

A Y.js peer keeps its copy of a document, and merges it in when it connects again. That is what
makes offline editing work, and it has a consequence for any server that can throw a document
away and start it again, for example a test server that seeds a fresh document on start. A
browser tab or agent that still holds the old copy reconnects, and the two copies merge: every
element twice, with the same ids.

y-quorum prevents this: each time a document is created it has a new incarnation, and a client
holding a copy of an earlier one discards it rather than merging it in. The handle then emits
`rebuilt`, with the content in a new `Y.Doc`, or `closed` when the document is gone. The agent's
editors are bound to the old one: leave and join again, as the agent lab in this repository
does. With another server, give each incarnation of a document a name of its own, and turn away
clients that ask for an old one.
