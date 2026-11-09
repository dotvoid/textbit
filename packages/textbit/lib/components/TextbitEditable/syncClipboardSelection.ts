import { Range, Transforms, type Editor } from 'slate'
import { ReactEditor } from 'slate-react'

/**
 * WORKAROUND for https://github.com/ianstormtaylor/slate/pull/6364
 *
 * slate-react writes the clipboard from `editor.selection`, which follows the
 * browser's selection only after a delayed, throttled `selectionchange`. A copy
 * or cut right after selecting, such as Ctrl+A then Ctrl+C, wrote the previous
 * selection or nothing at all. This brings `editor.selection` up to date with
 * the browser's selection before slate-react writes the clipboard.
 *
 * Remove it once textbit requires a slate-react with that fix.
 *
 * Returns true when the event is handled here and slate-react should leave it:
 * when the browser's selection reaches the editor but has no Slate range, for
 * instance one dragged past the editor's edge. A copy is then left to the
 * browser, which copies what is selected, and a cut is cancelled so nothing
 * stale is cut.
 */
export function syncClipboardSelection(
  editor: Editor,
  event: React.ClipboardEvent<HTMLDivElement>,
  type: 'copy' | 'cut',
  ownSelection: boolean
): boolean {
  // Block selection sets editor.selection itself; the browser's may differ
  if (ownSelection || isInput(event.target)) {
    return false
  }

  let root: HTMLElement
  let domSelection: Selection | null
  try {
    root = ReactEditor.toDOMNode(editor, editor)
    domSelection = ReactEditor.getWindow(editor).getSelection()
  } catch {
    return false
  }

  if (!domSelection || domSelection.rangeCount === 0) {
    return false
  }

  const { anchorNode, focusNode } = domSelection
  const anchorInside = !!anchorNode && root.contains(anchorNode)
  const focusInside = !!focusNode && root.contains(focusNode)
  if (!anchorInside && !focusInside) {
    return false
  }

  const range = anchorInside && focusInside
    ? ReactEditor.toSlateRange(editor, domSelection, { exactMatch: false, suppressThrow: true })
    : null

  if (!range) {
    if (type === 'cut') {
      event.preventDefault()
    }
    return true
  }

  if (!editor.selection || !Range.equals(range, editor.selection)) {
    Transforms.select(editor, range)
  }
  return false
}

function isInput(target: EventTarget): boolean {
  return target instanceof Element && !!target.closest('input, textarea')
}
