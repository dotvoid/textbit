import { Editor, Range } from 'slate'
import { ReactEditor, defaultScrollSelectionIntoView } from 'slate-react'

/**
 * Scrolls a new selection into view, as slate-react does after it moves the
 * DOM selection, with two exceptions:
 *
 * - A selection made with the pointer never scrolls: what was clicked is on
 *   screen already. Scrolling for it made the editor jump, e.g. on the first
 *   click into an editor, or on a click on an image whose bottom was below the
 *   window.
 * - On a void block, such as an image, the block is scrolled into view, only
 *   as far as needed. The DOM selection sits in its hidden spacer, which is
 *   rendered after the content, so scrolling to it showed the bottom edge.
 */
export function scrollSelectionIntoView(editor: Editor, domRange: globalThis.Range, fromPointer: boolean) {
  if (fromPointer) {
    return
  }

  const { selection } = editor
  const voidEntry = selection && Range.isCollapsed(selection)
    ? Editor.void(editor, { at: selection })
    : undefined

  if (voidEntry) {
    try {
      ReactEditor.toDOMNode(editor, voidEntry[0]).scrollIntoView({ block: 'nearest', inline: 'nearest' })
    } catch {
      // Not rendered
    }
    return
  }

  defaultScrollSelectionIntoView(editor, domRange)
}
