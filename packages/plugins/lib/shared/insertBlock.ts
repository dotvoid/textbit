import { TextbitEditor } from '@dotvoid/textbit'
import { Editor, Transforms, type Element } from 'slate'

/** Insert a block after the top-level block holding the caret, and move into it */
export function insertBlockAfterCaret(editor: Editor, block: Element): void {
  const position = TextbitEditor.position(editor)
  const at = [position < 0 ? editor.children.length : position + 1]
  Transforms.insertNodes(editor, block, { at })
  Transforms.select(editor, Editor.start(editor, at))
}

export function textNode(type: string): Element {
  return { id: crypto.randomUUID(), class: 'text', type, children: [{ text: '' }] }
}
