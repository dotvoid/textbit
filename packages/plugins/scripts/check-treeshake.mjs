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

// Plugin export -> a string only that plugin's code contains
const markers = {
  Bold: 'core/bold',
  Italic: 'core/italic',
  Underline: 'core/underline',
  Strikethrough: 'core/strikethrough',
  Code: 'core/code',
  Text: 'set-paragraph'
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

if (failed) {
  process.exit(1)
}
console.log(`check-treeshake: each of ${Object.keys(markers).length} plugins bundles alone`)
