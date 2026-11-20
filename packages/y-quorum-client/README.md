# @dotvoid/y-quorum-client

The client of [`@dotvoid/y-quorum`](https://github.com/dotvoid/textbit/tree/main/packages/y-quorum),
for the browser and for Node. One connection carries any number of documents, opened in full or
watched as a few fields, and the same document can be shown in several editable views of one
page. Textbit editors bind to a document's text fields; comments, suggestions, who wrote what,
versions and records come with it.

```bash
npm install @dotvoid/y-quorum-client @dotvoid/textbit @y/y @y/protocols slate
```

## In short

```tsx
import * as Y from '@y/y'
import { createClient } from '@dotvoid/y-quorum-client'
import { Textbit } from '@dotvoid/textbit'

const client = createClient({ url: 'ws://localhost:1234', token })
const handle = await client.open('demo', 'note-1')
const body = handle.content.getAttr('body')

export const Note = () => body instanceof Y.Node && (
  <Textbit.Root value={body} awareness={handle.awareness}>
    <Textbit.Editable aria-label='Note' />
  </Textbit.Root>
)
```

- `handle.content` is the document's tree: plain fields are attributes, text fields are nodes
  an editor binds to.
- The server decides what the person may do (`handle.capabilities`) and refuses the rest. A
  refused change is handed back to the app, and the client starts again from the server's state.
- `handle.claimOrigin({ agent })` lets an agent work through the person's connection, its
  changes recorded as the agent's, for the person.

The document model (`defineType` and the field kinds) is in `@dotvoid/y-quorum-client/model`,
and exported from the package itself too; the wire protocol is in
`@dotvoid/y-quorum-client/protocol`.

## Documentation

- [y-quorum, the client](https://github.com/dotvoid/textbit/blob/main/docs/guides/y-quorum-client.md):
  connecting, documents and views, editors, comments, suggestions, versions, rejections, agents
- [y-quorum, the server](https://github.com/dotvoid/textbit/blob/main/docs/guides/y-quorum.md)
- [Suggestions](https://github.com/dotvoid/textbit/blob/main/docs/guides/suggestions.md)

## Licence

MIT
