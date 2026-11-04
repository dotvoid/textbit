import { describe, test, expect, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { Editor, createEditor, type Descendant, type Element } from 'slate'
import { Slate, withReact } from 'slate-react'
import { PendingDropsProvider } from '../lib/contexts/PendingDropsProvider'
import { usePendingDrops } from '../lib/hooks/usePendingDrops'
import type { ConsumeFunction } from '../lib/types'
import { pipeFromDrop } from '../lib/utils/pipes'

function makeEditor(children: Descendant[]): Editor {
  const editor = withReact(createEditor())
  editor.children = children
  return editor
}

function twoParagraphs(): Descendant[] {
  return [
    { id: 'a', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'aaa' }] } as Descendant,
    { id: 'b', type: 'core/text', class: 'text', properties: {}, children: [{ text: 'bbb' }] } as Descendant
  ]
}

/**
 * Build a plugin that acts as a consumer for `image/*` produces `core/image`.
 * Test controls whether `consume` resolves, rejects, or opts out.
 */
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
      consumes: () => [true, 'core/image', false] as [boolean, string, boolean],
      consume
    }
  }
}

function fakeDropEvent(mimeType: string, data: string) {
  const items = [{ kind: 'string', type: mimeType }] as unknown as DataTransferItemList
  const dt = {
    types: [mimeType],
    items,
    getData: (t: string) => (t === mimeType ? data : ''),
    files: []
  } as unknown as DataTransfer
  return { dataTransfer: dt, preventDefault: () => {}, stopPropagation: () => {} } as unknown as React.DragEvent
}

function Reader({ onDrops }: { onDrops: (drops: ReturnType<typeof usePendingDrops>) => void }) {
  const drops = usePendingDrops()
  onDrops(drops)
  return null
}

async function tickMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('executePipeItem — pending drops store integration', () => {
  test('successful consume inserts result at drop position and clears the marker', async () => {
    let resolveConsume: (v: unknown) => void = () => {}
    const consume: ConsumeFunction = () => new Promise((res) => { resolveConsume = res })
    const plugin = imageConsumerPlugin(consume)

    const editor = makeEditor(twoParagraphs())
    let latest: ReturnType<typeof usePendingDrops> = []
    render(
      <Slate editor={editor} initialValue={editor.children}><PendingDropsProvider editor={editor}>
        <Reader onDrops={(d) => { latest = d }} />
      </PendingDropsProvider></Slate>
    )

    act(() => {
      pipeFromDrop(editor, [plugin], fakeDropEvent('image/png', 'blob'), 1)
    })
    // Marker appears
    expect(latest).toHaveLength(1)
    expect(latest[0].kind).toBe('core/image')

    // Consumer resolves with a real element
    await act(async () => {
      resolveConsume({
        type: 'core/image',
        data: { id: 'img1', type: 'core/image', class: 'block', properties: {}, children: [{ text: '' }] } as Element
      })
      await tickMicrotasks()
    })

    // Marker vanishes
    expect(latest).toHaveLength(0)
    // Result inserted at position 1
    expect((editor.children[1] as Element).id).toBe('img1')
    // No stray core/loader node anywhere
    expect(editor.children.some((c) => (c as Element).type === 'core/loader')).toBe(false)
  })

  test('consume that throws clears the marker and leaves the document untouched', async () => {
    const consume: ConsumeFunction = () => Promise.reject(new Error('boom'))
    const plugin = imageConsumerPlugin(consume)

    const editor = makeEditor(twoParagraphs())
    const before = JSON.parse(JSON.stringify(editor.children))
    let latest: ReturnType<typeof usePendingDrops> = []
    render(
      <Slate editor={editor} initialValue={editor.children}><PendingDropsProvider editor={editor}>
        <Reader onDrops={(d) => { latest = d }} />
      </PendingDropsProvider></Slate>
    )
    // Silence expected warn.
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await act(async () => {
      pipeFromDrop(editor, [plugin], fakeDropEvent('image/png', 'blob'), 1)
      await tickMicrotasks()
    })

    expect(latest).toHaveLength(0)
    expect(editor.children).toEqual(before)
  })

  test('consume that resolves undefined (opt out) clears the marker with no insert', async () => {
    const consume: ConsumeFunction = () => Promise.resolve(undefined)
    const plugin = imageConsumerPlugin(consume)

    const editor = makeEditor(twoParagraphs())
    const before = JSON.parse(JSON.stringify(editor.children))
    let latest: ReturnType<typeof usePendingDrops> = []
    render(
      <Slate editor={editor} initialValue={editor.children}><PendingDropsProvider editor={editor}>
        <Reader onDrops={(d) => { latest = d }} />
      </PendingDropsProvider></Slate>
    )

    await act(async () => {
      pipeFromDrop(editor, [plugin], fakeDropEvent('image/png', 'blob'), 1)
      await tickMicrotasks()
    })

    expect(latest).toHaveLength(0)
    expect(editor.children).toEqual(before)
  })

  test('never inserts a core/loader placeholder into the document', async () => {
    let resolveConsume: (v: unknown) => void = () => {}
    const consume: ConsumeFunction = () => new Promise((res) => { resolveConsume = res })
    const plugin = imageConsumerPlugin(consume)

    const editor = makeEditor(twoParagraphs())
    render(<Slate editor={editor} initialValue={editor.children}><PendingDropsProvider editor={editor}><span /></PendingDropsProvider></Slate>)

    act(() => {
      pipeFromDrop(editor, [plugin], fakeDropEvent('image/png', 'blob'), 1)
    })
    // Pending — no loader in the document.
    expect(editor.children.some((c) => (c as Element).type === 'core/loader')).toBe(false)

    await act(async () => {
      resolveConsume({
        type: 'core/image',
        data: { id: 'img1', type: 'core/image', class: 'block', properties: {}, children: [{ text: '' }] } as Element
      })
      await tickMicrotasks()
    })
    // After success — still no loader.
    expect(editor.children.some((c) => (c as Element).type === 'core/loader')).toBe(false)
  })
})
