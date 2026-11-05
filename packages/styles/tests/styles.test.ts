import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'

const root = resolve(__dirname, '..')
const css = (file: string) => readFileSync(join(root, 'css', file), 'utf8')

function sources(dir: string): string {
  return readdirSync(dir).map((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return sources(path)
    }
    return /\.(tsx?)$/.test(name) ? readFileSync(path, 'utf8') : ''
  }).join('\n')
}

function selectors(file: string): string[] {
  const out: string[] = []
  postcss.parse(css(file)).walkRules((rule: Rule) => {
    out.push(...rule.selectors)
  })
  return out
}

describe('textbit-styles', () => {
  test.each(['variables.css', 'editor.css', 'plugins.css', 'index.css'])('%s parses', (file) => {
    expect(() => postcss.parse(css(file))).not.toThrow()
  })

  test('styles every part of textbit\'s own UI', () => {
    const emitted = new Set([...sources(resolve(root, '../textbit/lib')).matchAll(/data-tb='([a-z-]+)'/g)].map((m) => m[1]))
    const styled = css('editor.css')
    const missing = [...emitted].filter((hook) => !styled.includes(`[data-tb="${hook}"]`))

    expect(emitted.size).toBeGreaterThan(10)
    expect(missing).toEqual([])
  })

  test('styles every class the plugins render', () => {
    const code = sources(resolve(root, '../plugins/lib'))
    const literal = [...code.matchAll(/className=['"]([^'"]+)['"]/g)].flatMap((m) => m[1].split(/\s+/))
    // Text renders tb-text plus tb-<role>
    const roles = ['tb-paragraph', ...[1, 2, 3, 4, 5, 6].map((n) => `tb-heading-${n}`)]
    const classes = new Set([...literal, ...roles].filter((c) => c.startsWith('tb-')))
    // Wrappers that need no style of their own
    const unstyled = new Set(['tb-paragraph', 'tb-unordered-list', 'tb-ordered-list', 'tb-table-row', 'tb-image-content', 'tb-audio-content',
      'tb-image-alt', 'tb-image-caption', 'tb-audio-caption'])
    const styled = css('plugins.css')
    const missing = [...classes].filter((c) => !unstyled.has(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(styled))

    expect(classes.size).toBeGreaterThan(20)
    expect(missing).toEqual([])
  })

  test('never styles anything outside textbit', () => {
    const scoped = /^(\[data-tb="|\[data-spelling-|\.tb-)/
    const leaks = [...selectors('editor.css'), ...selectors('plugins.css')].filter((s) => !scoped.test(s.trim()))
    expect(leaks).toEqual([])
    expect(selectors('variables.css')).toEqual([':root'])
  })

  test('every token used is defined', () => {
    const defined = new Set([...css('variables.css').matchAll(/(--tb-[\w-]+):/g)].map((m) => m[1]))
    const used = new Set([...(css('editor.css') + css('plugins.css')).matchAll(/var\((--tb-[\w-]+)/g)].map((m) => m[1]))
    expect([...used].filter((token) => !defined.has(token))).toEqual([])
  })
})
