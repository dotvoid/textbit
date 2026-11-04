# Textbit

A React rich-text editor built on Slate, with collaborative editing through Yjs.

| Package | |
|---------|---|
| [`@dotvoid/textbit`](packages/textbit) | The editor. See its [README](packages/textbit/README.md) for the documentation. |

## Development

```bash
npm install     # installs every package in packages/
npm run dev     # the editor's demo app
npm test        # tests for every package
npm run build   # builds every package
```

## Releasing

Releases are published from GitHub Actions when a version tag is pushed. To release
the editor, run `npm version <patch|minor|major>` in `packages/textbit`.
