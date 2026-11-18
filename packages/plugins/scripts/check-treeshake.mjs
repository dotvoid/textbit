// Fails the build when importing one plugin pulls in another. For each plugin,
// bundle a tiny host that imports only that plugin from the built package, in
// ESM and CommonJS, and look for the other plugins' names in the result.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const external = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })

// Plugin export -> a string only that plugin's code contains. The two list
// types name each other on purpose, to switch a list between them, so they are
// told apart by their titles.
const markers = {
  Bold: 'base/bold',
  Italic: 'base/italic',
  Underline: 'base/underline',
  Strikethrough: 'base/strikethrough',
  Code: 'toggle-code',
  Text: 'set-paragraph',
  UnorderedList: 'Bullet list',
  OrderedList: 'Numbered list',
  CodeBlock: 'base/code-block',
  Table: 'base/table',
  Link: 'base/link',
  LocalizedQuotationMarks: 'base/localized-quotation-marks',
  Image: 'base/image',
  Audio: 'base/audio',
  Blockquote: 'base/blockquote'
}

let failed = false
for (const [name, own] of Object.entries(markers)) {
  for (const format of ['esm', 'cjs']) {
    const source = format === 'esm'
      ? `import { ${name} } from '@dotvoid/textbit-plugins'; console.log(${name}())`
      : `const { ${name} } = require('@dotvoid/textbit-plugins'); console.log(${name}())`

    const result = await build({
      stdin: { contents: source, resolveDir: root, loader: 'js' },
      bundle: true,
      minify: true,
      write: false,
      format,
      platform: 'browser',
      external,
      alias: { '@dotvoid/textbit-plugins': root },
      logLevel: 'silent'
    })
    const code = result.outputFiles[0].text

    if (!code.includes(own)) {
      console.error(`check-treeshake: ${name} (${format}) is missing its own code`)
      failed = true
    }
    // CommonJS cannot be tree-shaken by bundlers; only report it
    const others = Object.values(markers).filter((marker) => marker !== own && code.includes(marker))
    if (others.length && format === 'esm') {
      console.error(`check-treeshake: importing ${name} also bundles ${others.join(', ')}`)
      failed = true
    }
  }
}

// The definitions entry runs without React: each plugin from it, bundled with
// its imports listed, must import no React package
const REACT = /^(react|react-dom|slate-react|@slate-yjs\/react)(\/|$)/
for (const name of Object.keys(markers)) {
  const result = await build({
    stdin: {
      contents: `import { ${name} } from '@dotvoid/textbit-plugins/definitions'; console.log(${name}())`,
      resolveDir: root,
      loader: 'js'
    },
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'node',
    external,
    alias: { '@dotvoid/textbit-plugins/definitions': resolve(root, 'dist/definitions.js') },
    logLevel: 'silent'
  })
  const imports = Object.values(result.metafile.inputs).flatMap((input) => input.imports.map((i) => i.path))
  const react = [...new Set(imports.filter((path) => REACT.test(path)))]
  if (react.length) {
    console.error(`check-treeshake: the definition of ${name} imports ${react.join(', ')}`)
    failed = true
  }
}

if (failed) {
  process.exit(1)
}
console.log(`check-treeshake: each of ${Object.keys(markers).length} plugins bundles alone, and its definition without React`)
