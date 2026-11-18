import { Editor, Element, Transforms } from 'slate'
import { enterBlockFromEnd } from '../components/TextbitEditable/handleOnKeyDown/blockUtils'

type Listener = (blockId: string | null) => void

/** The editable's block caret, which lives in React state */
const LISTENERS = new WeakMap<Editor, Listener>()

/** Let editor commands place the block caret. Returns the removal. */
export function listenForBlockCaret(editor: Editor, listener: Listener): () => void {
  LISTENERS.set(editor, listener)
  return () => {
    if (LISTENERS.get(editor) === listener) {
      LISTENERS.delete(editor)
    }
  }
}

/**
 * Put the caret after the top-level block at index, as after a paste: a block
 * caret after it when it is an object, as the keyboard places one, or the caret
 * at the end of its text.
 */
export function placeCaretAfter(editor: Editor, index: number): void {
  const block = editor.children[index]
  if (!Element.isElement(block)) {
    return
  }

  if (block.class !== 'text' && block.id) {
    enterBlockFromEnd(editor, [index], block)
    LISTENERS.get(editor)?.(block.id)
    return
  }

  Transforms.select(editor, Editor.end(editor, [index]))
  LISTENERS.get(editor)?.(null)
}
