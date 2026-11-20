# Textbit

A React rich-text editor built on Slate, with collaborative editing through Yjs.

| Package | |
|---------|---|
| [`@dotvoid/textbit`](packages/textbit) | The editor. See its [README](packages/textbit/README.md) for the documentation. |
| [`@dotvoid/textbit-plugins`](packages/plugins) | Ready to use plugins: headings, formatting, lists, links, tables, code, quotes, images, audio. |
| [`@dotvoid/textbit-styles`](packages/styles) | A default look for the editor and the plugins, in plain CSS. |
| [`@dotvoid/textbit-agent`](packages/agent) | Tools for AI agents to read and edit documents alongside people, in any agent framework. |

[`apps/demo`](apps/demo) uses all three, as a host would.

## Documentation

The guides are in [docs](docs/README.md), in reading order. To begin with:

- [Getting started](docs/guides/getting-started.md): install, a first editor, plugins, styles
- [Collaboration](docs/guides/collaboration.md): editing together over Y.js 14
- [y-quorum](docs/guides/y-quorum.md) and [its client](docs/guides/y-quorum-client.md): the
  server for documents people and agents write together
- [Agents](docs/guides/agents.md): AI agents in the document
- [What's new in 3.0](docs/guides/whats-new-in-3.md), and
  [Upgrading from 2.x](docs/guides/upgrading-from-2.md) with every breaking change

Background on decisions that shape textbit:

- [Where comments and suggestions live](docs/background/comments-and-suggestions.md): why they
  sit in documents of their own beside the content, and how that leads into Y.js 14

## Development

```bash
npm install       # installs every package
npm run dev       # the demo: editor, plugins and styles, from source
npm run dev:core  # the editor's own test bench, without the plugins package
npm test          # tests for every package
npm run build     # builds every package
npm run lab       # a shared document for an AI agent over MCP, see apps/agent-lab
```

## Releasing

Releases are published from GitHub Actions when a version tag is pushed. Run
`npm version <patch|minor|major>` in a package's folder: it tests, builds, commits,
tags and pushes. See [RELEASING.md](RELEASING.md).
