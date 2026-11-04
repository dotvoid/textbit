import { Editor, Range, Transforms } from 'slate'
import type { AdjacentBlockState } from '../contexts/AdjacentBlockContext'
import { insertParagraphBeside } from '../components/TextbitEditable/handleOnKeyDown/blockUtils'

/**
 * Insert text exactly as given, for commands rather than typing: text consumers
 * (typographic quotes and the like) never see it, so a straight quote picked
 * from a list stays straight.
 *
 * An expanded selection is removed through `deleteFragment`, which keeps the
 * block boundary guard. With the caret parked beside a block the text goes in
 * a new paragraph next to it, as typing does. Returns false when there is
 * nowhere to insert.
 */
export function insertTextAtCaret(
  editor: Editor,
  text: string,
  adjacentBlock: AdjacentBlockState | null = null
): boolean {
  if (adjacentBlock && insertParagraphBeside(editor, adjacentBlock)) {
    Transforms.insertText(editor, text)
    return true
  }

  if (!editor.selection) {
    return false
  }

  if (Range.isExpanded(editor.selection)) {
    Editor.deleteFragment(editor)
  }

  if (!editor.selection) {
    return false
  }

  Transforms.insertText(editor, text)
  return true
}
