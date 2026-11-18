// @vitest-environment node
import { describe, test, expect } from 'vitest'
import type { Descendant } from 'slate'
import { getSchema, validate, toJsonSchema } from '@dotvoid/textbit/headless'
import {
  Text, Bold, Italic, Code, UnorderedList, OrderedList, CodeBlock, Table, Link,
  Image, Audio, Blockquote, LocalizedQuotationMarks
} from '../lib/definitions'

const PLUGINS = [
  Text(), Bold(), Italic(), Code(), UnorderedList(), OrderedList(), CodeBlock(), Table(), Link(),
  Image(), Audio(), Blockquote(), LocalizedQuotationMarks()
]

const text = (id: string, children: Descendant[], role?: string) =>
  ({ id, type: 'base/text', class: 'text', properties: role ? { role } : {}, children }) as Descendant
const field = (id: string, type: string, value: string) =>
  ({ id, type, class: 'text', children: [{ text: value }] }) as Descendant

const ARTICLE: Descendant[] = [
  text('h', [{ text: 'A title' }], 'heading-1'),
  text('lead', [{ text: 'The lead-in' }], 'preamble'),
  text('p', [
    { text: 'Some ' },
    { text: 'bold', 'base/bold': true },
    { text: ' and a ' },
    { id: 'l', type: 'base/link', class: 'inline', properties: { href: 'https://example.com' }, children: [{ text: 'link' }] },
    { text: '' }
  ]),
  { id: 'ul', type: 'base/unordered-list', class: 'text', children: [field('i1', 'base/unordered-list/list-item', 'One')] } as Descendant,
  {
    id: 't', type: 'base/table', class: 'block', children: [
      { id: 'r', type: 'base/table/row', class: 'block', children: [field('c1', 'base/table/row/cell', 'a'), field('c2', 'base/table/row/cell', 'b')] }
    ]
  } as Descendant,
  {
    id: 'img', type: 'base/image', class: 'block', properties: { src: 'https://example.com/a.png', width: 800 }, children: [
      { id: 'ic', type: 'base/image/content', class: 'void', children: [{ text: '' }] },
      field('ia', 'base/image/alt', 'Hills'),
      field('icap', 'base/image/caption', 'In winter')
    ]
  } as Descendant,
  {
    id: 'q', type: 'base/blockquote', class: 'block', children: [
      field('qb', 'base/blockquote/body', 'Calm'),
      field('qc', 'base/blockquote/citation', '')
    ]
  } as Descendant,
  { id: 'cb', type: 'base/code-block', class: 'block', children: [field('cbb', 'base/code-block/body', 'x = 1')] } as Descendant
]

describe('the plugins described', () => {
  test('a document using every plugin is valid', () => {
    expect(validate(ARTICLE, PLUGINS)).toEqual([])
  })

  test('the schema names what each element means and stores', () => {
    const schema = getSchema(PLUGINS)
    expect(schema.elements['base/image'].properties?.src.required).toBe(true)
    expect(schema.elements['base/link'].properties?.href.required).toBe(true)
    expect(schema.elements['base/text'].properties?.role.enum).toEqual(['heading-1', 'heading-2', 'heading-3', 'heading-4', 'preamble'])
    expect(schema.elements['base/image/alt'].marks).toEqual([])
    expect(schema.elements['base/code-block/body'].allowBreak).toBe(true)
    expect(schema.elements['base/blockquote/body'].allowSoftBreak).toBe(true)
    expect(schema.marks['base/bold']).toEqual({ description: 'Bold text' })
    expect(Object.values(schema.elements).every((element) => element.description)).toBe(true)
  })

  test('what an agent might get wrong is named', () => {
    const issues = validate([
      text('h', [{ text: 'x' }], 'heading-7'),
      { id: 'img', type: 'base/image', class: 'block', properties: {}, children: [
        { id: 'ic', type: 'base/image/content', class: 'void', children: [{ text: '' }] },
        { id: 'ia', type: 'base/image/alt', class: 'text', children: [{ text: 'a', 'base/bold': true }] }
      ] } as Descendant,
      { id: 'l', type: 'base/link', class: 'inline', properties: { href: 'x' }, children: [{ text: 'x' }] } as Descendant
    ], PLUGINS).filter((issue) => issue.severity === 'error').map((issue) => `${issue.code}@${issue.path.join('.')}`)

    expect(issues).toEqual([
      'invalid-property@0',
      'missing-property@1',
      'mark-not-allowed@1.1.0',
      'too-few@1',
      'misplaced@2'
    ])
  })

  test('the JSON Schema covers every element type', () => {
    const json = toJsonSchema(getSchema(PLUGINS))
    expect(Object.keys(json.$defs as object)).toEqual(expect.arrayContaining(['base/table/row/cell', 'base/link', 'text']))
  })
})
