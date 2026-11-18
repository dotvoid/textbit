# @dotvoid/textbit-agent

Tools for AI agents to read and edit [`@dotvoid/textbit`](https://github.com/dotvoid/textbit/tree/main/packages/textbit)
documents, in the same document as the people writing it, under the same rules.

The package owns no server, no model and no framework. It gives an agent access to one
editor's document, and plain tool descriptors (a name, a description, a JSON Schema, a handler
and a text rendering of the result) that you hand to whatever runs your model: an MCP server,
a model SDK, or your own loop in the page. Nothing in it needs React or a browser.

```bash
npm install @dotvoid/textbit-agent
```

## In short

```ts
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Link, Image } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent, createAgentTools } from '@dotvoid/textbit-agent'

const plugins = [Text(), Bold(), Link(), Image()]
const editor = createTextbitEditor({ plugins, value })

const agent = createDocumentAgent(editor, { plugins })
const tools = createAgentTools(agent)
// document_read, document_search, document_types, document_edit
```

- The agent reads the document one element per line, with short handles for each element,
  and writes the same lines back.
- It edits with six operations, applied together or not at all, checked against the
  document's schema, refused with a clear error when something is wrong.
- In a shared document its presence and what it changed show in everyone's editor, and a run
  of its edits can be undone as one.
- With `review: 'suggest'` it changes nothing: people accept or reject its suggestions, block
  by block.

## Documentation

- [Agents](https://github.com/dotvoid/textbit/blob/main/docs/guides/agents.md): what an agent
  sees and does, the line format, operations, errors, presence and runs
- [Agents over MCP](https://github.com/dotvoid/textbit/blob/main/docs/guides/agents-mcp.md): a
  complete MCP server, model SDKs, and an agent in the page
- [Agents on a server](https://github.com/dotvoid/textbit/blob/main/docs/guides/agents-server.md):
  joining a shared document from Node
- [Suggestions](https://github.com/dotvoid/textbit/blob/main/docs/guides/suggestions.md)
- [Formats](https://github.com/dotvoid/textbit/blob/main/docs/guides/formats.md): the line
  format, tools and what is sent between peers, as specifications

## Licence

MIT
