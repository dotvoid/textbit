# @dotvoid/y-quorum

A collaboration server for documents that people and agents write together, on Y.js 14.
Documents are typed trees of rich text fields, plain values and keyed lists, with comments,
suggestions and records beside them. The server judges every change by rules you give it, holds
agents to the rights of the person they act for, and keeps a history of who changed what, as a
hash chain that can be exported, checked and signed.

One process and a SQLite file run everything. Postgres, object storage and more than one node
are there when you need them, and a host's own JSON store can be used from the start.

```bash
npm install @dotvoid/y-quorum @dotvoid/textbit @y/y @y/protocols slate
```

Node 22.13 or later.

## In short

```ts
import { createServer, defineType, object, sqlite, text } from '@dotvoid/y-quorum'

const note = defineType('example/note', {
  content: object({ title: text({ plugins: 'singleLine' }), body: text() }),
  comments: true,
  suggestions: true,
  history: true
})

const server = createServer({
  types: [note],
  storage: sqlite('documents.sqlite'),
  // Yours to decide: here, one fixed token
  authenticate: (token) => token === process.env.TOKEN
    ? { principal: { kind: 'person', id: 'alice', name: 'Alice' }, namespaces: ['demo'] }
    : null
})

if (!(await server.read('demo', 'note-1'))) {
  await server.create('demo', 'note-1', 'example/note')
}
await server.listen(1234)
```

Pages and services connect with
[`@dotvoid/y-quorum-client`](https://github.com/dotvoid/textbit/tree/main/packages/y-quorum-client),
and textbit editors bind to the document's text fields. `@dotvoid/y-quorum/mcp` lets agents
in over the Model Context Protocol.

## Documentation

- [y-quorum, the server](https://github.com/dotvoid/textbit/blob/main/docs/guides/y-quorum.md):
  types, policies, the write pipeline, history, storage, more than one node
- [y-quorum, the client](https://github.com/dotvoid/textbit/blob/main/docs/guides/y-quorum-client.md)
- [Suggestions](https://github.com/dotvoid/textbit/blob/main/docs/guides/suggestions.md)
- [Agents over MCP](https://github.com/dotvoid/textbit/blob/main/docs/guides/agents-mcp.md#agents-at-a-y-quorum-server)

## Licence

MIT
