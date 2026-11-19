import { describe, test, expect } from 'vitest'
import { render, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Editor, createEditor, type Element } from 'slate'
import { Slate, withReact } from 'slate-react'
import * as Y from '@y/y'
import { Awareness } from '@y/protocols/awareness'
import { bindField, pointToRelativePosition, seedField } from '../lib/yjs'
import { PendingDropsProvider } from '../lib/contexts/PendingDropsProvider'
import { SharedAwarenessContext } from '../lib/contexts/SharedAwarenessContext'
import { usePendingDrops } from '../lib/hooks/usePendingDrops'

function seed(): Element[] {
  return [
    { id: 'a', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'aaa' }] } as Element,
    { id: 'b', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'bbb' }] } as Element,
    { id: 'c', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'ccc' }] } as Element
  ]
}

function makeCollaborativeEditor(children: Element[]): Editor {
  const field = new Y.Doc().get('body')
  seedField(field, children)
  const editor = withReact(createEditor())
  bindField(editor, field)
  return editor
}

/** The editor and its provider, with the awareness SlateContainer would give them */
function Shared({ editor, awareness, children }: {
  editor: Editor
  awareness: Awareness | null
  children: ReactNode
}) {
  return (
    <Slate editor={editor} initialValue={editor.children}>
      <SharedAwarenessContext.Provider value={{ awareness }}>
        <PendingDropsProvider editor={editor}>{children}</PendingDropsProvider>
      </SharedAwarenessContext.Provider>
    </Slate>
  )
}

function startOf(editor: Editor, path: number[]): Y.RelativePosition {
  const position = pointToRelativePosition(editor, Editor.start(editor, path))
  if (!position) {
    throw new Error(`no position at ${JSON.stringify(path)}`)
  }
  return position
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

describe('PendingDropsProvider — awareness broadcast (own → peers)', () => {
  test('mirrors local drops onto awareness.pendingDrops', async () => {
    const awareness = new Awareness(new Y.Doc())
    const editor = makeCollaborativeEditor(seed())
    render(<Shared editor={editor} awareness={awareness}><span /></Shared>)

    await act(async () => {
      editor.pendingDrops!.start({ pathRef: Editor.pathRef(editor, [1]), kind: 'image' })
      await tickMicrotasks()
    })

    const localState = awareness.getLocalState() ?? {}
    const wire = (localState.pendingDrops ?? []) as Array<{ id: string, kind?: string, relPos: number[] }>
    expect(wire).toHaveLength(1)
    expect(wire[0].kind).toBe('image')
    expect(Array.isArray(wire[0].relPos)).toBe(true)
    expect(wire[0].relPos.length).toBeGreaterThan(0)
  })

  test('clears awareness.pendingDrops when the last local drop ends', async () => {
    const awareness = new Awareness(new Y.Doc())
    const editor = makeCollaborativeEditor(seed())
    render(<Shared editor={editor} awareness={awareness}><span /></Shared>)

    let id = ''
    await act(async () => {
      id = editor.pendingDrops!.start({ pathRef: Editor.pathRef(editor, [0]), kind: 'image' })
      await tickMicrotasks()
    })
    expect((awareness.getLocalState() as { pendingDrops?: unknown }).pendingDrops).toBeTruthy()

    await act(async () => {
      editor.pendingDrops!.end(id)
      await tickMicrotasks()
    })
    expect((awareness.getLocalState() as { pendingDrops?: unknown }).pendingDrops).toBeNull()
  })

  test('does not broadcast when the editor is not collaborative', async () => {
    // No awareness → no broadcast attempt.
    const editor = withReact(createEditor())
    editor.children = seed()
    render(<Slate editor={editor} initialValue={editor.children}><PendingDropsProvider editor={editor}><span /></PendingDropsProvider></Slate>)

    await act(async () => {
      editor.pendingDrops!.start({ pathRef: Editor.pathRef(editor, [0]), kind: 'image' })
      await tickMicrotasks()
    })
    // No throw is the acceptance criterion; nothing to inspect.
  })

  test('clears our field on Provider unmount so peers see us vanish', async () => {
    const awareness = new Awareness(new Y.Doc())
    const editor = makeCollaborativeEditor(seed())
    const { unmount } = render(<Shared editor={editor} awareness={awareness}><span /></Shared>)

    await act(async () => {
      editor.pendingDrops!.start({ pathRef: Editor.pathRef(editor, [0]), kind: 'image' })
      await tickMicrotasks()
    })
    expect((awareness.getLocalState() as { pendingDrops?: unknown }).pendingDrops).toBeTruthy()

    unmount()
    expect((awareness.getLocalState() as { pendingDrops?: unknown }).pendingDrops).toBeNull()
  })
})

describe('PendingDropsProvider — awareness subscribe (peers → local)', () => {
  test('renders a peer drop received via awareness change', async () => {
    // Peer B's editor + Provider is under test. We fabricate a peer A wire
    // message with a distinct clientID and inject it into B's awareness map
    // to simulate a state that just arrived over the network.
    const bAwareness = new Awareness(new Y.Doc())
    const editorB = makeCollaborativeEditor(seed())

    let latest: ReturnType<typeof usePendingDrops> = []
    render(
      <Shared editor={editorB} awareness={bAwareness}>
        <Reader onDrops={(d) => { latest = d }} />
      </Shared>
    )

    // Encode a RelativePosition for [1] using B's own field — the same
    // content lives in both peers' fields in a real session.
    const relPos = startOf(editorB, [1])
    const fakePeerId = bAwareness.clientID + 1

    await act(async () => {
      bAwareness.states.set(fakePeerId, {
        pendingDrops: [{
          id: 'wire-1',
          relPos: Array.from(Y.encodeRelativePosition(relPos)),
          kind: 'image'
        }],
        data: { name: 'Alice', color: '#f00' }
      })
      bAwareness.emit('change', [
        { added: [fakePeerId], updated: [], removed: [] },
        'test'
      ])
      await tickMicrotasks()
    })

    const peerDrops = latest.filter((d) => d.source === 'peer')
    expect(peerDrops).toHaveLength(1)
    expect(peerDrops[0].kind).toBe('image')
    expect(peerDrops[0].peerId).toBe(fakePeerId)
    expect(peerDrops[0].path).toEqual([1])
    expect(peerDrops[0].peerData).toEqual({ name: 'Alice', color: '#f00' })
  })

  test('peer drop vanishes when their awareness state is removed', async () => {
    const bAwareness = new Awareness(new Y.Doc())
    const editorB = makeCollaborativeEditor(seed())

    let latest: ReturnType<typeof usePendingDrops> = []
    render(
      <Shared editor={editorB} awareness={bAwareness}>
        <Reader onDrops={(d) => { latest = d }} />
      </Shared>
    )

    const relPos = startOf(editorB, [1])
    const fakePeerId = bAwareness.clientID + 1

    await act(async () => {
      bAwareness.states.set(fakePeerId, {
        pendingDrops: [{
          id: 'wire-1',
          relPos: Array.from(Y.encodeRelativePosition(relPos)),
          kind: 'image'
        }]
      })
      bAwareness.emit('change', [
        { added: [fakePeerId], updated: [], removed: [] },
        'test'
      ])
      await tickMicrotasks()
    })
    expect(latest.filter((d) => d.source === 'peer')).toHaveLength(1)

    // Peer disconnect: state removed. In production this happens automatically
    // when their awareness expires (WebSocket drop, tab close).
    await act(async () => {
      bAwareness.states.delete(fakePeerId)
      bAwareness.emit('change', [
        { added: [], updated: [], removed: [fakePeerId] },
        'test'
      ])
      await tickMicrotasks()
    })

    expect(latest.filter((d) => d.source === 'peer')).toHaveLength(0)
  })

  test('ignores awareness changes that do not touch pendingDrops', async () => {
    // Cursor movements broadcast via awareness every keystroke. The peer read
    // must short-circuit when no peer's pendingDrops field changed, otherwise
    // we re-decode positions on every cursor tick. Fires an awareness change
    // with only cursor data updates and verifies the peer drop list doesn't
    // churn.
    const bAwareness = new Awareness(new Y.Doc())
    const editorB = makeCollaborativeEditor(seed())

    let renderCount = 0
    function Counter() {
      const drops = usePendingDrops()
      renderCount += 1
      // Reference `drops` so the linter doesn't optimise it away.
      void drops
      return null
    }

    render(
      <Shared editor={editorB} awareness={bAwareness}>
        <Counter />
      </Shared>
    )

    const rendersBefore = renderCount

    // Peer moves their cursor — awareness fires 'change', but `pendingDrops`
    // is untouched.
    const fakePeerId = bAwareness.clientID + 1
    await act(async () => {
      bAwareness.states.set(fakePeerId, {
        cursor: { anchor: 1, focus: 2 },
        data: { name: 'Alice' }
      })
      bAwareness.emit('change', [
        { added: [fakePeerId], updated: [], removed: [] },
        'test'
      ])
      await tickMicrotasks()
    })

    // No cursor field means the peer's pendingDrops didn't change. The
    // Provider must NOT setState → the consumer must NOT re-render.
    expect(renderCount).toBe(rendersBefore)
  })
})
