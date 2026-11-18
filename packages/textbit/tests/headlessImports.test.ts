// @vitest-environment node
import { describe, test, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * The headless entry must load without React. Walk every module it imports,
 * type-only imports aside, and list any that is a React component file or
 * imports a React package.
 */

const REACT = /^(react|react-dom|slate-react|@slate-yjs\/react)(\/|$)/
// Type-only imports are followed too: they load nothing, but a component file
// among them makes a type check of the headless source need JSX
const IMPORT = /^\s*(import|export)\s+(type\s)?[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function reactImports(entry: string): string[] {
  const seen = new Set<string>()
  const offenders: string[] = []
  const queue = [entry]

  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) {
      continue
    }
    seen.add(file)

    if (file.endsWith('.tsx')) {
      offenders.push(file)
    }

    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(IMPORT)) {
      const specifier = match[3] ?? match[4]
      const typeOnly = !!match[2]
      if (REACT.test(specifier) && !typeOnly) {
        offenders.push(`${file} -> ${specifier}`)
      } else if (specifier.startsWith('.')) {
        const target = resolveModule(file, specifier)
        if (target) {
          queue.push(target)
        }
      }
    }
  }

  return offenders.map((o) => o.replace(`${resolve(__dirname, '..')}/`, ''))
}

describe('the headless entry', () => {
  test('imports nothing that needs React', () => {
    expect(reactImports(resolve(__dirname, '../lib/headless.ts'))).toEqual([])
  })
})
