import { describe, test, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSlateStatic } from 'slate-react'
import { type PropsWithChildren } from 'react'
import { Editor, Node, Transforms, type Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { StandardPlugins } from '../lib/components/core'
import type { PluginDefinition, ConsumeFunction } from '../lib/types'

/**
 * A real editor, composed the way TextbitRoot composes it, so typing goes
 * through every wrapper rather than a copy of withInsertText's logic.
 * Passing `plugins` replaces the standard set, so they are added back -
 * without core/text the paragraph cannot be typed into at all.
 */
function makeEditor(plugins: PluginDefinition[]): Editor {
  const content: Descendant[] = [
    { id: 'a', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'ab' }] }
  ]
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <TextbitRoot
        value={content}
        onChange={() => {}}
        plugins={[...StandardPlugins.map((p) => p()), ...plugins]}
      >
        <TextbitEditable>{children}</TextbitEditable>
      </TextbitRoot>
    )
  }
  const { result: { current: editor } } = renderHook(() => useSlateStatic(), { wrapper: Wrapper })
  vi.spyOn(editor, 'onChange').mockImplementation(() => {})
  Transforms.select(editor, Editor.end(editor, [0]))
  return editor
}

function consumerFor(
  type: string,
  claims: (data: unknown) => boolean,
  consume: ConsumeFunction,
  produces = 'text/plain'
): PluginDefinition {
  return {
    class: 'generic',
    name: 'test/consumer',
    consumer: {
      consumes: ({ input }) => [input.type === type && claims(input.data), produces],
      consume
    }
  }
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

const text = (editor: Editor) => Node.string(editor.children[0])

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pasteToConsumers - typing through withInsertText', () => {
  test('a consumer that throws falls back to the typed character', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor([
      consumerFor('text/plain', (d) => d === 'x', () => Promise.reject(new Error('boom')))
    ])

    editor.insertText('x')
    await settle()

    expect(text(editor)).toBe('abx')
  })

  test('typing on after a throwing consumer keeps both characters', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor([
      consumerFor('text/plain', (d) => d === 'x', () => Promise.reject(new Error('boom')))
    ])

    editor.insertText('x')
    await settle()
    editor.insertText('y')
    await settle()

    // An unsettled promise took the `x` with it and left nothing behind, so
    // `y` still went in normally and the lost character read as a one-off.
    expect(text(editor)).toBe('abxy')
  })

  test('a consumer that returns text replaces the typed character', async () => {
    const editor = makeEditor([
      consumerFor('text/plain', (d) => d === '"', async ({ input }) => ({
        ...(Array.isArray(input) ? input[0] : input),
        data: '”'
      }))
    ])

    editor.insertText('"')
    await settle()

    expect(text(editor)).toBe('ab”')
  })

  test('a consumer that resolves undefined falls back to the typed character', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor([
      consumerFor('text/plain', (d) => d === 'x', async () => undefined)
    ])

    editor.insertText('x')
    await settle()

    expect(text(editor)).toBe('abx')
  })

  test('unclaimed keystrokes never reach consume()', async () => {
    const consume = vi.fn<ConsumeFunction>(async () => undefined)
    const editor = makeEditor([consumerFor('text/plain', (d) => d === 'x', consume)])

    editor.insertText('y')

    // Inserted synchronously, without waiting on a consumer.
    expect(text(editor)).toBe('aby')
    expect(consume).not.toHaveBeenCalled()
  })
})

describe('pasteToConsumers - pasting through withInsertHtml', () => {
  test('a consumer that throws on paste still settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor([
      consumerFor('text/html', () => true, () => Promise.reject(new Error('boom')), 'test/block')
    ])
    const data = {
      types: ['text/html', 'text/plain'],
      getData: (t: string) => (t === 'text/plain' ? 'pasted' : '<p>pasted</p>')
    } as unknown as DataTransfer

    editor.insertData(data)
    await settle()

    // Unsettled, this is an unhandled rejection and fails the run.
    expect(warn).toHaveBeenCalledWith('Consumer threw when handling paste', expect.any(Error))
  })
})
