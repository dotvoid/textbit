import { describe, test, expect } from 'vitest'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Italic, Link, Image, UnorderedList, Table, Blockquote } from '@dotvoid/textbit-plugins/definitions'
import { createDocumentAgent, createAgentTools, type EditOperation, type EditResult } from '../lib'

const PLUGINS = [Text(), Bold(), Italic(), Link(), Image(), UnorderedList(), Table(), Blockquote()]

const ID = {
  title: 'aaaaaaaa-0000-4000-8000-000000000001',
  body: 'bbbbbbbb-0000-4000-8000-000000000002',
  link: 'cccccccc-0000-4000-8000-000000000003',
  image: 'dddddddd-0000-4000-8000-000000000004',
  content: 'dddddddd-1111-4000-8000-000000000005',
  alt: 'dddddddd-2222-4000-8000-000000000006',
  caption: 'dddddddd-3333-4000-8000-000000000007',
  list: 'eeeeeeee-0000-4000-8000-000000000008',
  item: 'eeeeeeee-1111-4000-8000-000000000009',
  factbox: 'ffffffff-0000-4000-8000-000000000010'
}

function document(): Descendant[] {
  return [
    { id: ID.title, type: 'base/text', class: 'text', properties: { role: 'heading-1' }, children: [{ text: 'A harbour [town]' }] },
    {
      id: ID.body, type: 'base/text', class: 'text', properties: {}, children: [
        { text: 'Boats ' },
        { text: 'stay', 'base/bold': true },
        { text: ' in. See ' },
        { id: ID.link, type: 'base/link', class: 'inline', properties: { href: 'https://example.com' }, children: [{ text: 'more' }] },
        { text: '.' }
      ]
    },
    {
      id: ID.image, type: 'base/image', class: 'block', properties: { src: 'https://example.com/a.png' }, children: [
        { id: ID.content, type: 'base/image/content', class: 'void', children: [{ text: '' }] },
        { id: ID.alt, type: 'base/image/alt', class: 'text', children: [{ text: 'Hills' }] },
        { id: ID.caption, type: 'base/image/caption', class: 'text', children: [{ text: 'In winter' }] }
      ]
    },
    {
      id: ID.list, type: 'base/unordered-list', class: 'text', children: [
        { id: ID.item, type: 'base/unordered-list/list-item', class: 'text', children: [{ text: 'One' }] }
      ]
    },
    {
      id: ID.factbox, type: 'acme/factbox', class: 'block', properties: {}, children: [
        { id: 'f1', type: 'acme/factbox/body', class: 'text', children: [{ text: 'Facts' }] }
      ]
    }
  ] as Descendant[]
}

function setup(options: Parameters<typeof createDocumentAgent>[1] = {}) {
  const editor = createTextbitEditor({ plugins: PLUGINS, value: document() })
  const agent = createDocumentAgent(editor, { plugins: PLUGINS, ...options })
  return { editor, agent }
}

function ok(result: EditResult): asserts result is EditResult & { ok: true } {
  if (!result.ok) {
    throw new Error(`edit failed: ${JSON.stringify(result.error)}`)
  }
}

const text = (editor: Editor, id: string) => {
  const [entry] = Editor.nodes(editor, { at: [], match: (n) => (n as { id?: string }).id === id })
  return entry ? Node.string(entry[0]) : undefined
}

describe('reading', () => {
  test('one line per element, children indented, handles, short names, marks and inlines', () => {
    const { agent } = setup()
    expect(agent.read().view).toBe([
      '[#aaaaaa text role="heading-1"] A harbour \\[town\\]',
      '[#bbbbbb text] Boats [stay]{bold} in. See [more]{link href="https://example.com" #cccccc}.',
      '[#dddddddd-0 image src="https://example.com/a.png"]',
      '  [#dddddddd-1 content]',
      '  [#dddddddd-2 alt] Hills',
      '  [#dddddddd-3 caption] In winter',
      '[#eeeeeeee-0 unordered-list]',
      '  [#eeeeeeee-1 list-item] One',
      '[#ffffff acme/factbox unknown] "Facts"'
    ].join('\n'))
  })

  test('pages by top-level element', () => {
    const { agent } = setup()
    const first = agent.read({ limit: 2 })
    expect(first.view.split('\n')).toHaveLength(2)
    expect(first.total).toBe(5)
    expect(first.next).toBe('dddddddd-0')
    expect(agent.read({ from: first.next, limit: 1 }).view).toContain('image src=')
  })

  test('search finds text elements, with the top-level element they are in', () => {
    const { agent } = setup()
    expect(agent.search({ query: 'WINTER' }).matches).toEqual([
      { line: '[#dddddddd-3 caption] In winter', in: 'dddddddd-0' }
    ])
  })

  test('the types, for a model', () => {
    const { agent } = setup()
    const types = agent.describe()
    expect(types).toContain('image: An image with alternative text and a caption')
    expect(types).toContain('alt: What the image shows, for those who cannot see it (exactly 1; one line; no marks)')
    expect(types).toContain('href (string, required)')
    expect(types).toContain('bold: Bold text')
  })
})

describe('editing', () => {
  test('replace one element keeps its handle; content is parsed with marks and links', () => {
    const { editor, agent } = setup()
    const result = agent.edit({ operations: [
      { op: 'replace', id: 'bbbbbb', content: '[text] New [words]{bold italic} and [a link]{link href="https://a.b"}' }
    ] })
    ok(result)
    expect(result.view).toMatch(/^\[#bbbbbb text\] New \[words\]\{bold italic\} and \[a link\]\{link href="https:\/\/a\.b" #\w+\}$/)
    expect(text(editor, ID.body)).toBe('New words and a link')
  })

  test('insert after an element, and into a list', () => {
    const { editor, agent } = setup()
    ok(agent.edit({ operations: [
      { op: 'insert', after: 'aaaaaa', content: '[text role="preamble"] A lead-in\n[text] And more' },
      { op: 'insert', into: 'eeeeeeee-0', content: '[list-item] Two' }
    ] }))
    expect(editor.children.map((n) => Node.string(n))).toEqual([
      'A harbour [town]', 'A lead-in', 'And more', 'Boats stay in. See more.', 'HillsIn winter', 'OneTwo', 'Facts'
    ])
    expect((editor.children[1] as { properties: object }).properties).toEqual({ role: 'preamble' })
  })

  test('the editor adds required children content leaves out', () => {
    const { editor, agent } = setup()
    const result = agent.edit({ operations: [{ op: 'insert', content: '[image src="https://x.y/b.png"]\n  [caption] A caption' }] })
    ok(result)
    const image = editor.children[5] as { children: { type: string }[] }
    expect(image.children.map((c) => c.type)).toEqual(['base/image/content', 'base/image/alt', 'base/image/caption'])
    expect(result.view).toMatch(/^\[#\w+ image src="https:\/\/x\.y\/b\.png"\]\n {2}\[#\w+ content\]\n {2}\[#\w+ alt\]\n {2}\[#\w+ caption\] A caption$/)
  })

  test('replaceText keeps marks, and names what it cannot find', () => {
    const { editor, agent } = setup()
    ok(agent.edit({ operations: [{ op: 'replaceText', id: 'bbbbbb', find: 'stay', replace: 'rest' }] }))
    expect(agent.read().view).toContain('Boats [rest]{bold} in.')
    expect(text(editor, ID.body)).toBe('Boats rest in. See more.')

    const missing = agent.edit({ operations: [{ op: 'replaceText', id: 'bbbbbb', find: 'nope', replace: 'x' }] })
    expect(missing).toMatchObject({ ok: false, error: { code: 'text-not-found', operation: 0 } })
  })

  test('setProperties sets and removes; delete and move', () => {
    const { editor, agent } = setup()
    ok(agent.edit({ operations: [
      { op: 'setProperties', id: 'aaaaaa', properties: { role: null } },
      { op: 'move', id: 'eeeeeeee-0', before: 'aaaaaa' },
      { op: 'delete', id: 'dddddddd-0' }
    ] }))
    expect(editor.children.map((n) => (n as { type: string }).type)).toEqual(['base/unordered-list', 'base/text', 'base/text', 'acme/factbox'])
    expect((editor.children[1] as { properties: object }).properties).toEqual({})
  })

  test('a batch applies completely or not at all', () => {
    const { editor, agent } = setup()
    const before = structuredClone(editor.children)
    const result = agent.edit({ operations: [
      { op: 'delete', id: 'aaaaaa' },
      { op: 'replace', id: 'nothere', content: '[text] x' }
    ] })
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found', operation: 1 } })
    expect(editor.children).toEqual(before)
  })

  test('content that breaks the schema is refused, with what is wrong', () => {
    const { editor, agent } = setup()
    const before = structuredClone(editor.children)
    const result = agent.edit({ operations: [{ op: 'setProperties', id: 'aaaaaa', properties: { role: 'heading-9' } }] })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-content' } })
    expect(!result.ok && result.error.issues?.[0].message).toContain('role must be one of')
    expect(editor.children).toEqual(before)
  })

  test('parse errors say where and what would be right', () => {
    const { agent } = setup()
    const result = agent.edit({ operations: [{ op: 'insert', content: '[paragraph] Hi' }] })
    expect(result).toMatchObject({ ok: false, error: { code: 'parse-error', operation: 0 } })
    expect(!result.ok && result.error.message).toBe('Line 1: paragraph cannot stand at the top level; it can be one of: text, image, unordered-list, table, blockquote')
  })

  test('an element whose plugin is missing can be moved, not changed or removed', () => {
    const { agent } = setup()
    expect(agent.edit({ operations: [{ op: 'delete', id: 'ffffff' }] })).toMatchObject({ ok: false, error: { code: 'not-allowed' } })
    expect(agent.edit({ operations: [{ op: 'replaceText', id: 'ffffff', find: 'Facts', replace: 'x' }] })).toMatchObject({ ok: false, error: { code: 'not-allowed' } })
    ok(agent.edit({ operations: [{ op: 'move', id: 'ffffff', before: 'aaaaaa' }] }))

    const { agent: trusted } = setup({ unknownElements: 'all' })
    ok(trusted.edit({ operations: [{ op: 'delete', id: 'ffffff' }] }))
  })

  test('an opId is applied once', () => {
    const { editor, agent } = setup()
    const operations: EditOperation[] = [{ op: 'insert', content: '[text] Once' }]
    const first = agent.edit({ operations, opId: 'x1' })
    const second = agent.edit({ operations, opId: 'x1' })
    expect(second).toEqual(first)
    expect(editor.children.filter((n) => Node.string(n) === 'Once')).toHaveLength(1)
  })

  test('read-only refuses edits and offers no edit tool', () => {
    const { agent } = setup({ readOnly: true })
    expect(agent.edit({ operations: [{ op: 'delete', id: 'aaaaaa' }] })).toMatchObject({ ok: false, error: { code: 'read-only' } })
    expect(createAgentTools(agent).map((tool) => tool.name)).toEqual(['document_read', 'document_search', 'document_types'])
  })
})

describe('revisions', () => {
  test('a change elsewhere since the read does not stop an edit', () => {
    const { editor, agent } = setup()
    const { revision } = agent.read()
    Transforms.insertText(editor, '!', { at: Editor.end(editor, [0]) })
    ok(agent.edit({ revision, operations: [{ op: 'replaceText', id: 'bbbbbb', find: 'Boats', replace: 'Ships' }] }))
  })

  test('a change to the element since the read does, and shows it as it is now', () => {
    const { editor, agent } = setup()
    const { revision } = agent.read()
    Transforms.insertText(editor, ' Moored.', { at: Editor.end(editor, [1]) })
    const result = agent.edit({ revision, operations: [{ op: 'replaceText', id: 'bbbbbb', find: 'Boats', replace: 'Ships' }] })
    expect(result).toMatchObject({ ok: false, error: { code: 'stale' } })
    expect(!result.ok && result.view).toContain('Moored.')
    expect(text(editor, ID.body)).toContain('Boats')
  })

  test('an unknown revision is checked against the whole document', () => {
    const { agent } = setup()
    expect(agent.edit({ revision: 'zzz', operations: [{ op: 'delete', id: 'aaaaaa' }] })).toMatchObject({ ok: false, error: { code: 'stale' } })
  })
})

describe('tools', () => {
  test('plain descriptors with JSON Schema input, for any framework', async () => {
    const { editor, agent } = setup()
    const tools = createAgentTools(agent, { prefix: 'article_' })
    expect(tools.map((tool) => tool.name)).toEqual(['article_read', 'article_search', 'article_types', 'article_edit'])

    const edit = tools.find((tool) => tool.name === 'article_edit')!
    const input = JSON.parse(JSON.stringify({ operations: [{ op: 'delete', id: 'aaaaaa' }] }))
    expect(await edit.handler(input)).toMatchObject({ ok: true })
    expect(editor.children).toHaveLength(4)
  })
})

describe('elements sharing an id', () => {
  test('get path handles, and an edit to one gives it an id of its own', () => {
    const twice = [
      ...document().slice(0, 2),
      ...structuredClone(document().slice(0, 2))
    ]
    const editor = createTextbitEditor({ plugins: PLUGINS, value: twice })
    const agent = createDocumentAgent(editor, { plugins: PLUGINS })

    const lines = agent.read().view.split('\n')
    expect(lines[0]).toMatch(/^\[#@0 text/)
    expect(lines[3]).toMatch(/^\[#@3 text\] Boats \[stay\]\{bold\} in\. See \[more\]\{link href="https:\/\/example\.com" #@3\.3\}\.$/)

    expect(agent.edit({ operations: [{ op: 'delete', id: 'bbbbbb' }] }))
      .toMatchObject({ ok: false, error: { code: 'ambiguous-id', message: 'bbbbbb could be @1 or @3' } })

    const result = agent.edit({ operations: [{ op: 'setProperties', id: '@3.3', properties: { href: 'https://dotvoid.com' } }] })
    ok(result)
    const links = editor.children.map((block) => ((block as { children: { properties?: { href?: string } }[] }).children[3])?.properties?.href)
    expect(links).toEqual([undefined, 'https://example.com', undefined, 'https://dotvoid.com'])
    expect(result.view).toMatch(/link href="https:\/\/dotvoid\.com" #\w{6}\}/)
  })
})
