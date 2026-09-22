import { describe, test, expect, vi, afterEach } from 'vitest'
import { Editor, createEditor, type Descendant, type Element } from 'slate'
import { withReact } from 'slate-react'
import type { ConsumeFunction } from '../lib/types'
import { pipeFromDrop } from '../lib/utils/pipes'

function makeEditor(): Editor {
  const editor = withReact(createEditor())
  editor.children = [
    { id: 'a', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'aaa' }] } as Descendant
  ]
  return editor
}

function imageConsumerPlugin(consume: ConsumeFunction) {
  return {
    class: 'block' as const,
    name: 'core/image',
    componentEntry: {
      class: 'block' as const,
      component: () => null,
      constraints: {}
    },
    consumer: {
      consumes: ({ input }: { input: { type: string } }) =>
        [input.type.startsWith('image/'), 'core/image', false] as [boolean, string, boolean],
      consume
    }
  }
}

const insertsAnImage: ConsumeFunction = () => Promise.resolve({
  source: 'test',
  type: 'core/image',
  data: { id: 'img1', type: 'core/image', class: 'block', properties: {}, children: [{ text: '' }] } as Element
})

/** Build a drop event carrying one string item per mime type. */
function fakeDropEvent(types: string[]) {
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  const items = types.map((type) => ({ kind: 'string', type })) as unknown as DataTransferItemList
  const dt = {
    types,
    items,
    getData: (t: string) => (types.includes(t) ? `data:${t}` : ''),
    files: []
  } as unknown as DataTransfer
  const event = {
    dataTransfer: dt,
    preventDefault,
    stopPropagation
  } as unknown as React.DragEvent
  return { event, preventDefault, stopPropagation }
}

async function tickMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('initPipeForDrop — ignored drag metadata types', () => {
  test('chromium/x-drag-id alongside a real payload does not warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor()
    const { event } = fakeDropEvent(['chromium/x-drag-id', 'image/png'])

    pipeFromDrop(editor, [imageConsumerPlugin(insertsAnImage)], event, 1)
    await tickMicrotasks()

    expect(warn).not.toHaveBeenCalled()
    // The real payload was still consumed and inserted.
    expect((editor.children[1] as Element).id).toBe('img1')
  })

  test('a drop of only ignored types is swallowed, not passed on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor()
    const before = JSON.parse(JSON.stringify(editor.children))
    const { event, preventDefault, stopPropagation } = fakeDropEvent([
      'chromium/x-drag-id',
      'chromium/x-renderer-taint'
    ])

    pipeFromDrop(editor, [imageConsumerPlugin(insertsAnImage)], event, 1)
    await tickMicrotasks()

    expect(warn).not.toHaveBeenCalled()
    expect(editor.children).toEqual(before)
    // Letting this through would reach slate-react's drop handler, which moves
    // the caret to the drop point for a drop that carried nothing.
    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
  })

  test('a drop with no items at all is left alone', async () => {
    const editor = makeEditor()
    const { event, preventDefault, stopPropagation } = fakeDropEvent([])

    pipeFromDrop(editor, [imageConsumerPlugin(insertsAnImage)], event, 1)
    await tickMicrotasks()

    // Nothing was filtered, so there is nothing to compensate for - this is the
    // same fall-through as before the ignore list existed.
    expect(preventDefault).not.toHaveBeenCalled()
    expect(stopPropagation).not.toHaveBeenCalled()
  })

  test('a real type with no consumer still warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor()
    const { event } = fakeDropEvent(['application/x-nobody-wants-this'])

    pipeFromDrop(editor, [imageConsumerPlugin(insertsAnImage)], event, 1)
    await tickMicrotasks()

    expect(warn).toHaveBeenCalledWith(
      'Ignored dropped data/files of type application/x-nobody-wants-this'
    )
  })
})
