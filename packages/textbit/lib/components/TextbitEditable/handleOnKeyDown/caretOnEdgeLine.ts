import { Editor, type Path, type Point } from 'slate'
import { ReactEditor } from 'slate-react'

/**
 * Whether a point is on the last line of the element at path, or the first
 * when `last` is false. Measured in the page; where that cannot be done, the
 * end or the start of the element counts.
 */
export function caretOnEdgeLine(editor: Editor, point: Point, path: Path, last: boolean): boolean {
  try {
    const range = ReactEditor.toDOMRange(editor, { anchor: point, focus: point })
    const caret = range.getClientRects()[0] ?? range.getBoundingClientRect()
    const element = ReactEditor.toDOMNode(editor, Editor.node(editor, path)[0]).getBoundingClientRect()
    if (caret.height > 0) {
      return last ? element.bottom - caret.bottom < caret.height : caret.top - element.top < caret.height
    }
  } catch {
    // Not measurable
  }
  return last ? Editor.isEnd(editor, point, path) : Editor.isStart(editor, point, path)
}
