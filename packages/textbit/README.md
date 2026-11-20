# @dotvoid/textbit

A plugin-based rich text editor for React, built on Slate, with collaborative editing over
Y.js 14, and room in the document for AI agents.

- **Plugins for everything:** on its own, textbit edits plain paragraphs. Headings, formatting,
  lists, links, tables, images and the rest are plugins, each a definition (its elements,
  rules and actions) and a view (the components that render it).
- **Unstyled:** semantic HTML with `data-tb` hooks. A default look is a separate package.
- **Accessible:** keyboard access throughout, named controls, announcements for screen
  readers.
- **Together:** edit one document with others over Y.js 14, cursors and all.
- **Without a user interface:** the same editor, rules and plugins in Node, to read, change or
  check documents on a server.
- **With agents:** a schema of every document type, validation, agents' presence and changes
  shown in the text, and suggestions people accept or reject.

## Install

```bash
npm install @dotvoid/textbit @dotvoid/textbit-plugins @dotvoid/textbit-styles
```

`react`, `react-dom`, `slate`, `slate-react`, `@y/y` and `@y/protocols` are peer dependencies.

## A first editor

```tsx
import { useMemo, useState } from 'react'
import { Textbit, type TBElement } from '@dotvoid/textbit'
import { Text, Bold, Italic, Link } from '@dotvoid/textbit-plugins'
import '@dotvoid/textbit-styles'

const initial: TBElement[] = [
  { id: crypto.randomUUID(), type: 'base/text', class: 'text', children: [{ text: 'Hello world' }] }
]

export function Editor() {
  const [value, setValue] = useState(initial)
  const plugins = useMemo(() => [Text(), Bold(), Italic(), Link()], [])

  return (
    <Textbit.Root value={value} onChange={setValue} plugins={plugins}>
      <Textbit.Editable aria-label='Article' />
    </Textbit.Root>
  )
}
```

## Documentation

The guides, from a first editor to agents. The API reference is generated from the code.

- [Getting started](https://github.com/dotvoid/textbit/blob/main/docs/guides/getting-started.md)
- [Concepts](https://github.com/dotvoid/textbit/blob/main/docs/guides/concepts.md)
- [The editor](https://github.com/dotvoid/textbit/blob/main/docs/guides/the-editor.md)
- [Plugins](https://github.com/dotvoid/textbit/blob/main/docs/guides/plugins.md)
- [Styling](https://github.com/dotvoid/textbit/blob/main/docs/guides/styling.md)
- [Accessibility](https://github.com/dotvoid/textbit/blob/main/docs/guides/accessibility.md)
- [Collaboration](https://github.com/dotvoid/textbit/blob/main/docs/guides/collaboration.md),
  with [y-quorum](https://github.com/dotvoid/textbit/blob/main/docs/guides/y-quorum.md) and
  [its client](https://github.com/dotvoid/textbit/blob/main/docs/guides/y-quorum-client.md)
- [Without a user interface](https://github.com/dotvoid/textbit/blob/main/docs/guides/headless.md)
- [Schema and validation](https://github.com/dotvoid/textbit/blob/main/docs/guides/schema-and-validation.md)
- [Agents](https://github.com/dotvoid/textbit/blob/main/docs/guides/agents.md),
  [over MCP](https://github.com/dotvoid/textbit/blob/main/docs/guides/agents-mcp.md),
  [on a server](https://github.com/dotvoid/textbit/blob/main/docs/guides/agents-server.md)
- [Suggestions](https://github.com/dotvoid/textbit/blob/main/docs/guides/suggestions.md)
- [Formats](https://github.com/dotvoid/textbit/blob/main/docs/guides/formats.md)
- [Upgrading from 2.x](https://github.com/dotvoid/textbit/blob/main/docs/guides/upgrading-from-2.md)

## Entries

| Import | For |
|---|---|
| `@dotvoid/textbit` | The editor: components, hooks, and everything below |
| `@dotvoid/textbit/headless` | The editor without React or a browser: `createTextbitEditor`, shared documents (`seedField`, `fieldToValue`, `sharedOf`, `repairField`), `getSchema`, `validate`, suggestions, and the types a plugin definition needs |

## Related packages

- [`@dotvoid/textbit-plugins`](https://github.com/dotvoid/textbit/tree/main/packages/plugins):
  ready-made plugins
- [`@dotvoid/textbit-styles`](https://github.com/dotvoid/textbit/tree/main/packages/styles):
  a default look
- [`@dotvoid/textbit-agent`](https://github.com/dotvoid/textbit/tree/main/packages/agent):
  tools for AI agents to read and edit documents
- [`@dotvoid/y-quorum`](https://github.com/dotvoid/textbit/tree/main/packages/y-quorum) and
  [`@dotvoid/y-quorum-client`](https://github.com/dotvoid/textbit/tree/main/packages/y-quorum-client):
  a Y.js 14 server for shared documents, and its client

## Licence

MIT
