// @vitest-environment node
import { describe, test, expect } from 'vitest'
import type { Descendant } from 'slate'
import { getSchema } from '../lib/schema/getSchema'
import { validate } from '../lib/schema/validate'
import { toJsonSchema } from '../lib/schema/toJsonSchema'
import type { PluginDefinition } from '../lib/types/definition'

const figure: PluginDefinition = {
  class: 'block',
  name: 'test/figure',
  element: {
    class: 'block',
    schema: {
      description: 'A picture',
      properties: {
        src: { type: 'string', required: true },
        fit: { type: 'string', enum: ['cover', 'contain'] }
      }
    },
    children: [
      { type: 'content', class: 'void', constraints: { min: 1, max: 1 } },
      { type: 'caption', class: 'text', schema: { marks: 'none', inlines: 'none' }, constraints: { min: 1, max: 1, allowBreak: false } }
    ]
  }
}

const note: PluginDefinition = {
  class: 'inline',
  name: 'test/note',
  element: { class: 'inline' }
}

const bold: PluginDefinition = { class: 'leaf', name: 'test/bold', description: 'Bold', getStyle: () => ({ fontWeight: 'bold' }) }

const text: PluginDefinition = { class: 'text', name: 'base/text', element: { class: 'text' } }

const PLUGINS = [text, bold, note, figure]

const paragraph = (id: string, children: Descendant[] = [{ text: 'Hello' }]) =>
  ({ id, type: 'base/text', class: 'text', properties: {}, children }) as Descendant

const picture = (overrides: Record<string, unknown> = {}, children?: Descendant[]) => ({
  id: 'f',
  type: 'test/figure',
  class: 'block',
  properties: { src: 'a.png' },
  children: children ?? [
    { id: 'c', type: 'test/figure/content', class: 'void', children: [{ text: '' }] },
    { id: 'cap', type: 'test/figure/caption', class: 'text', children: [{ text: 'Caption' }] }
  ],
  ...overrides
}) as Descendant

describe('getSchema', () => {
  const schema = getSchema(PLUGINS)

  test('lists element types by full type, with their children in order', () => {
    expect(schema.elements['test/figure'].children).toEqual([
      { type: 'test/figure/content', min: 1, max: 1 },
      { type: 'test/figure/caption', min: 1, max: 1 }
    ])
    expect(schema.elements['test/figure/caption'].parent).toBe('test/figure')
    expect(schema.elements['test/figure'].description).toBe('A picture')
  })

  test('only plugin elements that are not inline stand at the top level', () => {
    expect(schema.topLevel).toEqual(['base/text', 'test/figure'])
  })

  test('resolves marks and inline elements per text type', () => {
    expect(schema.marks).toEqual({ 'test/bold': { description: 'Bold' } })
    expect(schema.elements['base/text'].marks).toEqual(['test/bold'])
    expect(schema.elements['base/text'].inlines).toEqual(['test/note'])
    expect(schema.elements['test/figure/caption'].marks).toEqual([])
    expect(schema.elements['test/figure/caption'].inlines).toEqual([])
  })

  test('reports breaks as the editor allows them', () => {
    expect(schema.elements['test/figure/caption'].allowBreak).toBe(false)
    expect(schema.elements['base/text'].allowSoftBreak).toBe(false)
  })

  test('without plugins, core text alone', () => {
    expect(getSchema().topLevel).toEqual(['base/text'])
  })
})

describe('validate', () => {
  const codes = (document: Descendant[]) => validate(document, PLUGINS).map((i) => `${i.code}@${i.path.join('.')}`)

  test('a valid document has no issues', () => {
    expect(validate([
      paragraph('p', [{ text: 'Hi ' }, { text: 'there', 'test/bold': true }]),
      picture()
    ], PLUGINS)).toEqual([])
  })

  test('names a missing required property, a wrong value and an undeclared one', () => {
    expect(codes([picture({ properties: { fit: 'stretch', extra: 1 } })])).toEqual([
      'missing-property@0', 'invalid-property@0', 'unknown-property@0'
    ])
  })

  test('counts children and checks their order, and what normalizing would change', () => {
    const content = { id: 'c', type: 'test/figure/content', class: 'void', children: [{ text: '' }] } as Descendant
    const caption = { id: 'cap', type: 'test/figure/caption', class: 'text', children: [{ text: 'x' }] } as Descendant
    expect(codes([picture({}, [caption, content])])).toEqual(['out-of-order@0.1', 'would-change@0'])
    expect(codes([picture({}, [content])])).toEqual(['too-few@0', 'would-change@0'])
  })

  test('marks and inline elements a field does not allow', () => {
    const caption = {
      id: 'cap',
      type: 'test/figure/caption',
      class: 'text',
      children: [
        { text: 'a', 'test/bold': true },
        { id: 'n', type: 'test/note', class: 'inline', children: [{ text: 'b' }] },
        { text: '' }
      ]
    } as Descendant
    const content = { id: 'c', type: 'test/figure/content', class: 'void', children: [{ text: '' }] } as Descendant
    const issues = codes([picture({}, [content, caption])])
    expect(issues).toContain('mark-not-allowed@0.1.0')
    expect(issues).toContain('inline-not-allowed@0.1.1')
  })

  test('elements in the wrong place, wrong class, ids', () => {
    expect(codes([
      { id: 'cap', type: 'test/figure/caption', class: 'text', children: [{ text: 'x' }] } as Descendant,
      paragraph('p'),
      { ...paragraph('p'), class: 'block' } as Descendant,
      { type: 'test/figure', class: 'block', properties: { src: 'a' }, children: [] } as unknown as Descendant
    ]).filter((code) => !code.startsWith('would-change'))).toEqual([
      'misplaced@0',
      'duplicate-id@2',
      'class-mismatch@2',
      'missing-id@3',
      'too-few@3',
      'too-few@3'
    ])
  })

  test('an element whose plugin is missing is a warning, and not looked into', () => {
    const issues = validate([
      { id: 'x', type: 'acme/factbox', class: 'block', children: [{ id: 'y', type: 'nope', class: 'block', children: [{ text: 'z' }] }] } as unknown as Descendant
    ], PLUGINS)
    expect(issues).toEqual([expect.objectContaining({ code: 'unknown-type', severity: 'warning', path: [0] })])
  })

  test('an unknown mark is a warning', () => {
    expect(validate([paragraph('p', [{ text: 'a', 'acme/glow': true }])], PLUGINS)).toEqual([
      expect.objectContaining({ code: 'unknown-mark', severity: 'warning', path: [0, 0] })
    ])
  })

  test('does not change the document', () => {
    const document = [picture({}, [])]
    const before = structuredClone(document)
    validate(document, PLUGINS)
    expect(document).toEqual(before)
  })
})

describe('toJsonSchema', () => {
  const json = toJsonSchema(getSchema(PLUGINS))
  const defs = json.$defs as Record<string, Record<string, unknown>>

  test('a definition per element type, referenced from the top level', () => {
    expect(json.type).toBe('array')
    expect(JSON.stringify(json.items)).toContain('#/$defs/test~1figure')
    expect(defs['test/figure'].required).toEqual(['type', 'class', 'children', 'id', 'properties'])
    expect((defs['test/figure'].properties as Record<string, { properties?: unknown }>).properties.properties)
      .toEqual({ src: { type: 'string' }, fit: { type: 'string', enum: ['cover', 'contain'] } })
  })

  test('every reference resolves', () => {
    const refs = [...JSON.stringify(json).matchAll(/"\$ref":"#\/\$defs\/([^"]+)"/g)]
      .map(([, ref]) => ref.replace(/~1/g, '/').replace(/~0/g, '~'))
    for (const ref of refs) {
      expect(defs[ref], ref).toBeDefined()
    }
  })
})
