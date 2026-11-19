# Textbit documentation

The guides, in reading order. The website builds from these files and from the API reference,
which `npm run docs:api` generates into `docs/reference` from the doc comments in the code.

| Guide | About |
|---|---|
| [Getting started](guides/getting-started.md) | Install, a first editor, plugins, styles |
| [Concepts](guides/concepts.md) | Documents, elements and their classes, ids, types, plugins |
| [The editor](guides/the-editor.md) | `Textbit.Root` and `Textbit.Editable`, menus, toolbar, gutter, context menu, comments, keyboard, copy and paste, read-only |
| [Plugins](guides/plugins.md) | Using the ready-made plugins, and writing your own: definition and view |
| [Styling](guides/styling.md) | The styles package, tokens, the `data-tb` hooks |
| [Accessibility](guides/accessibility.md) | Keyboard use, screen readers, what textbit does and what hosts do |
| [Collaboration](guides/collaboration.md) | Editing together over Y.js: cursors, presence, repairs |
| [Without a user interface](guides/headless.md) | `createTextbitEditor` on a server or in a script |
| [Schema and validation](guides/schema-and-validation.md) | `getSchema`, `validate`, `toJsonSchema`, describing a plugin |
| [Agents](guides/agents.md) | AI agents in the document: what they see and do |
| [Agents over MCP](guides/agents-mcp.md) | Serving the tools to any MCP client, and to model SDKs |
| [Agents on a server](guides/agents-server.md) | A headless editor joined to the shared document, presence, runs and undo |
| [Suggestions](guides/suggestions.md) | Proposed changes people accept or reject, and how they are stored |
| [Formats](guides/formats.md) | Specifications: what is stored in documents and sent between peers |
| [Upgrading from 2.x](guides/upgrading-from-2.md) | Every breaking change, with before and after |

## Background

- [Where comments and suggestions live](background/comments-and-suggestions.md): the
  architectures weighed, and why they sit in documents of their own beside the content

`internal/` holds what is for working on textbit itself, not for the website.
