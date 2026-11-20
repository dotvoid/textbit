# Agents over MCP

The tools from `createAgentTools` belong to no framework: each is a `name`, a `description`,
an `inputSchema` in JSON Schema, a `handler` and a `toText`. That is what the Model Context
Protocol lists and calls, and what model SDKs take as tools, so adapting them takes a few
lines. This guide shows three ways to put them in front of a model:

- an MCP server any MCP client can start, such as Claude Code or Claude Desktop;
- your own tool-calling loop with a model SDK;
- an agent working on the live editor in the page.

Read [Agents](./agents.md) first for what the tools do.

## An MCP server

An MCP server over stdio, for a document shared through a collaboration server. It joins the
document as a peer of its own, like a browser, so people see the agent's edits as it makes
them. How the joining works is explained in [Agents on a server](./agents-server.md).

```bash
npm install @dotvoid/textbit @dotvoid/textbit-plugins @dotvoid/textbit-agent \
  @modelcontextprotocol/server @hocuspocus/provider @slate-yjs/core slate yjs
```

```ts
// agent-server.ts
import {
  McpServer,
  fromJsonSchema,
  type JsonSchemaType,
  type JsonSchemaValidator,
  type jsonSchemaValidator
} from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { YjsEditor } from '@slate-yjs/core'
import type { Editor } from 'slate'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Italic, Link, Image } from '@dotvoid/textbit-plugins/definitions'
import { createAgentPresence, createAgentTools, createDocumentAgent } from '@dotvoid/textbit-agent'

// stdout carries the MCP messages: log to stderr only
const log = (...args: unknown[]) => console.error('[agent]', ...args)

// The same plugins as the editors in the document
const plugins = [Text(), Bold(), Italic(), Link(), Image()]

// Join the shared document
const ydoc = new Y.Doc()
const provider = new HocuspocusProvider({
  url: process.env.DOCUMENT_URL ?? 'ws://localhost:1234',
  name: process.env.DOCUMENT_NAME ?? 'article-123',
  document: ydoc,
  token: process.env.DOCUMENT_TOKEN ?? ''
})
await new Promise<void>((resolve) => provider.on('synced', () => resolve()))

const editor = createTextbitEditor({ plugins, shared: ydoc.get('content', Y.XmlText) })
YjsEditor.connect(editor as YjsEditor & Editor)

// The agent, with a presence people see
const presence = createAgentPresence(provider.awareness!, { name: 'Writing assistant', color: '#7c3aed' })
const agent = createDocumentAgent(editor, { plugins, presence })
const tools = createAgentTools(agent)

// The tools check their own input and explain mistakes in terms a model can act
// on, so the SDK passes the input through rather than refusing it first
const passThrough: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input) => ({ valid: true, data: input as T, errorMessage: undefined })
  }
}

serveStdio(() => {
  const server = new McpServer(
    { name: 'textbit-document', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: 'A shared document people are editing at the same time. Read it first, make small, targeted edits, and pass the revision of your read.'
    }
  )
  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType, passThrough)
    }, (input) => {
      const result = tool.handler(input)
      const failed = typeof result === 'object' && result !== null && 'ok' in result && result.ok === false
      log(tool.name, failed ? 'failed' : 'ok')
      return { isError: failed, content: [{ type: 'text', text: tool.toText(result) }] }
    })
  }
  return server
})
log('ready')

const quit = () => {
  presence.clear()
  provider.destroy()
  process.exit(0)
}
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
process.stdin.on('close', quit)
```

Notes:

- **Results as text.** `toText` writes the document's lines as they are, rather than escaped
  inside JSON, which models read far better. Failed edits are returned with `isError`, so the
  model sees them as errors and can correct itself.
- **SDK v2.** The example uses version 2 of the MCP TypeScript SDK (`@modelcontextprotocol/server`),
  which implements the 2026-07-28 revision of the protocol; `serveStdio` also serves clients
  that still speak the 2025 revisions. `fromJsonSchema` hands the tools' JSON Schema to the
  SDK as it is.
- **The tools validate their own input.** The pass-through validator lets a malformed call
  reach the tool, whose error says what is wrong and what would be right. The SDK's own
  validation would answer with a generic schema error instead.
- **Runs.** This server makes no runs. To let people undo an agent's task as one, start a run
  when a task begins and finish it when it ends; see [Runs](./agents-server.md#runs). An MCP
  server does not know where a task ends, so a pause between tool calls is a practical end,
  as the agent lab in this repository does.
- **Suggesting.** Pass `review: 'suggest'` and `suggestIn`, an editor on the fork of the
  document, to `createDocumentAgent` to make every edit a suggestion. If the option changes while the server runs, rebuild the tools and update the
  edit tool's description with `update({ description })` on what `registerTool` returned.
  Declare `capabilities: { tools: { listChanged: true } }`: the SDK then tells clients to fetch
  the new description. The agent lab's `apps/agent-lab/src/mcp.ts` does this.

### Connecting a client

**Claude Code:**

```bash
claude mcp add textbit-document -- "$(which node)" /absolute/path/to/agent-server.js
```

Start a new session and check that `/mcp` lists the server.

**Claude Desktop,** in its configuration file:

```json
{
  "mcpServers": {
    "textbit-document": {
      "command": "/full/path/to/node",
      "args": ["/absolute/path/to/agent-server.js"],
      "env": { "DOCUMENT_NAME": "article-123" }
    }
  }
}
```

Give node's full path. MCP clients start servers without loading your shell's profile, so a
`node` that your shell finds through a version manager is not on their path, and the server
never starts. Node 24 and later run TypeScript files directly; with an older Node, compile
the server first.

If the server does not appear, its log on stderr says why: most often that it could not reach
the collaboration server.

## Agents at a y-quorum server

With documents on a y-quorum server, mount `@dotvoid/y-quorum/mcp` instead of writing a server
of your own. It serves many documents over Streamable HTTP, and works through the y-quorum
server like any client, as the person the agent acts for, every change claimed as the agent's:
the server's rules, history and review evidence apply to agents as to everyone.

```ts
import { createMcpModule } from '@dotvoid/y-quorum/mcp'

const mcp = createMcpModule({
  url: 'ws://localhost:1234',
  types: [article],
  plugins: { default: plugins },
  // Who is calling: the person's token for y-quorum, and the agent
  identify: async (request) => {
    const session = await yourAuth(request.headers.get('authorization'))
    return session && {
      key: `${session.userId}:${session.clientId}`,
      token: session.quorumToken,
      agent: { id: session.clientId, name: session.clientName }
    }
  },
  // Your index: what the caller may find
  documents: async (caller, { text }) => ({ documents: await yourIndex.search(caller, text) }),
  // Agents only suggest in documents that are ready for publishing
  agentPolicy: ({ content }) => (content.status === 'ready' ? 'suggest' : 'edit')
})

// Mount it, e.g. with a framework that speaks web Requests
app.all('/mcp', (request) => mcp.fetch(request))
```

- **What agents may do** is the least of what the person may and what `agentPolicy` says:
  `none`, `read`, `comment`, `suggest` or `edit`. A refused edit tells the model to suggest
  instead where it may.
- **Tools:** `documents_list`, `document_fields` (the document as JSON, its text fields, what the
  agent may do), `document_set_field` (a plain field), `document_read`, `document_search`,
  `document_types`, `document_edit` and `document_suggest` (a text field, named by `field`),
  `suggestions_list`, `comments_list`, `comment_create` (by quoting the text) and
  `comment_reply`. Documents are named `namespace/id`.
- **Connections** are kept per caller and closed after a minute unused (`idle`).

## Your own tool-calling loop

Model SDKs that call tools take the same three things: a name, a description and a JSON Schema
for the input. A sketch of a loop, with the SDK calls left as comments since every SDK names
them differently:

```ts
import { createAgentTools, createDocumentAgent } from '@dotvoid/textbit-agent'

const agent = createDocumentAgent(editor, { plugins })
const tools = createAgentTools(agent)

// What the model is told it can call
const definitions = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema
}))

// Running a call the model made, and what goes back to it
function call(name: string, input: Record<string, unknown>) {
  const tool = tools.find((t) => t.name === name)
  if (!tool) {
    return { text: `No tool ${name}`, isError: true }
  }
  const result = tool.handler(input)
  const isError = typeof result === 'object' && result !== null && 'ok' in result && result.ok === false
  return { text: tool.toText(result), isError }
}

const run = agent.startRun()
// 1. Send the request and `definitions` to the model.
// 2. While it answers with tool calls: run each with `call`, send the texts back.
// 3. When it answers with text only, the task is done.
run.finish()
```

`run` lets the person undo the task as one; see [Runs](./agents.md#runs).

## In the browser

An agent can work on the live editor too. Its edits then go through the editor like any
other change. In a document that is not shared, the person's undo takes back each batch. In
a shared one it does not: agent edits have an origin of their own there, and the run undoes
them.

```tsx
import { Textbit, useEditor, type TBPlugin } from '@dotvoid/textbit'
import { createAgentTools, createDocumentAgent } from '@dotvoid/textbit-agent'
import { useMemo } from 'react'

function Assistant({ plugins }: { plugins: TBPlugin[] }) {
  const editor = useEditor()
  const tools = useMemo(() => createAgentTools(createDocumentAgent(editor, { plugins })), [editor, plugins])

  // Hand `tools` to your model loop, as above. The model runs on your server;
  // only the tool calls run here.
  return null
}

// Inside the editor's root, with the same plugins
<Textbit.Root plugins={plugins} value={value}>
  <Textbit.Editable aria-label='Article' />
  <Assistant plugins={plugins} />
</Textbit.Root>
```

Keep model credentials on the server: the page sends the conversation and the tool results to
your server, which calls the model and returns its tool calls.

In a document that is not shared through Y.js, people at other screens do not see the agent's
presence or its marked changes, and a run can only be undone while nobody else changed the
document.
