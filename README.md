# Textbit

A React rich-text editor built on Slate, with collaborative editing through Yjs.

| Package | |
|---------|---|
| [`@dotvoid/textbit`](packages/textbit) | The editor. See its [README](packages/textbit/README.md) for the documentation. |
| [`@dotvoid/textbit-plugins`](packages/plugins) | Ready to use plugins: headings, formatting, lists, links, tables, code, quotes, images, audio. |
| [`@dotvoid/textbit-styles`](packages/styles) | A default look for the editor and the plugins, in plain CSS. |

[`apps/demo`](apps/demo) uses all three, as a host would: `npm run dev:demo`.

## Development

```bash
npm install     # installs every package in packages/
npm run dev     # the editor's demo app
npm test        # tests for every package
npm run build   # builds every package
```

## Releasing

Releases are published from GitHub Actions when a version tag is pushed. Run
`npm version <patch|minor|major>` in a package's folder: it tests, builds, commits,
tags and pushes. See [RELEASING.md](RELEASING.md).
