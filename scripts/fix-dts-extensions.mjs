// Gives the relative imports in a package's emitted declarations the
// extensions Node's own module resolution needs. TypeScript projects that
// resolve modules as Node does ("moduleResolution": "NodeNext") cannot follow
// `from './agent'` and type the whole import as any, without a word. With
// `from './agent.js'`, every resolution mode finds agent.d.ts.
//
// Usage, from a package folder after its build: node ../../scripts/fix-dts-extensions.mjs
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')
const SPECIFIER = /((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]*?)(['"])/g

let files = 0
let fixed = 0

for (const file of declarations(dist)) {
  const source = readFileSync(file, 'utf8')
  const output = source.replace(SPECIFIER, (match, before, specifier, after) => {
    if (/\.(js|cjs|mjs|json)$/.test(specifier)) {
      return match
    }
    const base = resolve(dirname(file), specifier)
    const target = existsSync(`${base}.d.ts`)
      ? `${specifier}.js`
      : existsSync(join(base, 'index.d.ts')) ? `${specifier.replace(/\/$/, '')}/index.js` : null
    if (!target) {
      throw new Error(`fix-dts-extensions: ${specifier} in ${file} resolves to no declaration`)
    }
    fixed++
    return `${before}${target}${after}`
  })
  if (output !== source) {
    writeFileSync(file, output)
    files++
  }
}

console.log(`fix-dts-extensions: ${fixed} imports in ${files} declaration files`)

function declarations(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? declarations(path) : path.endsWith('.d.ts') ? [path] : []
  })
}
