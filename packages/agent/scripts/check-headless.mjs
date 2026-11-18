// Fails the build when the package would load React. Agents run on servers:
// bundle the built package with its imports listed, and look for React among
// them, the editor's own imports through its headless entry included.
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REACT = /^(react|react-dom|slate-react|@slate-yjs\/react)(\/|$)/

const result = await build({
  entryPoints: [resolve(root, 'dist/index.js')],
  bundle: true,
  write: false,
  metafile: true,
  format: 'esm',
  platform: 'node',
  // Resolve the editor's headless entry to its source, so its imports count too
  alias: { '@dotvoid/textbit/headless': resolve(root, '../textbit/lib/headless.ts') },
  external: ['slate', 'slate-history', 'slate-dom', 'yjs', '@slate-yjs/core', 'is-hotkey', 'react', 'react-dom', 'slate-react', '@slate-yjs/react'],
  logLevel: 'silent'
})

const imports = Object.values(result.metafile.inputs).flatMap((input) => input.imports.map((i) => i.path))
const react = [...new Set(imports.filter((path) => REACT.test(path)))]
if (react.length) {
  console.error(`check-headless: the agent package loads ${react.join(', ')}`)
  process.exit(1)
}
console.log('check-headless: the agent package loads no React')
