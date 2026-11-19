import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { Range } from 'slate'
import { ReactEditor, useSlate } from 'slate-react'
import { remoteCursors } from '../../yjs/cursors'
import { useSharedAwareness } from '../../contexts/SharedAwarenessContext'

/** Where a rectangle is, relative to the overlay */
export interface OverlayRect {
  top: number
  left: number
  width: number
  height: number
}

/** Another person's cursor, measured for drawing over the editor */
export interface RemoteCursorPosition {
  clientId: number
  data: Record<string, unknown> | undefined
  /** The caret, at the end where they are */
  caret: Omit<OverlayRect, 'width'> | null
  /** The selected text, one rectangle per line part */
  selection: OverlayRect[]
}

/**
 * The other people's cursors in this editor, measured against a container,
 * kept up to date as they move, as the text changes and as the page resizes
 */
export function useRemoteCursorPositions(containerRef: RefObject<HTMLElement | null>): RemoteCursorPosition[] {
  const editor = useSlate()
  const { awareness, cursor } = useSharedAwareness()
  const [moved, setMoved] = useState(0)
  const [positions, setPositions] = useState<RemoteCursorPosition[]>([])

  useEffect(() => {
    if (!awareness) {
      return
    }
    const changed = () => setMoved((n) => n + 1)
    awareness.on('change', changed)
    window.addEventListener('resize', changed)
    return () => {
      awareness.off('change', changed)
      window.removeEventListener('resize', changed)
    }
  }, [awareness])

  // Whenever the text, the cursors or the page changed: the text may have moved under them
  useLayoutEffect(() => {
    const container = containerRef.current
    const next = awareness && container ? measure() : []
    setPositions((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next))

    function measure(): RemoteCursorPosition[] {
      const origin = container!.getBoundingClientRect()
      return remoteCursors(editor, awareness!, cursor).map((remote) => {
        const relative = (rect: DOMRect) => ({
          top: rect.top - origin.top,
          left: rect.left - origin.left,
          width: rect.width,
          height: rect.height
        })
        let selection: OverlayRect[] = []
        let caret: RemoteCursorPosition['caret'] = null
        try {
          if (!Range.isCollapsed(remote.range)) {
            const rects = ReactEditor.toDOMRange(editor, remote.range).getClientRects?.() ?? []
            selection = Array.from(rects).map(relative)
          }
          const at = { anchor: remote.range.focus, focus: remote.range.focus }
          const rect = ReactEditor.toDOMRange(editor, at).getBoundingClientRect?.()
          if (rect) {
            const { top, left, height } = relative(rect)
            caret = { top, left, height }
          }
        } catch {
          // Not rendered (yet), or not in the page: nothing to draw
        }
        return { clientId: remote.clientId, data: remote.data, caret, selection }
      })
    }
  }, [editor, editor.children, containerRef, awareness, cursor, moved])

  return positions
}
