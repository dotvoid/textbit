import { type NodeEntry, type Range } from 'slate'
import { ReactEditor } from 'slate-react'

export function getNodeEntryFromDomNode(editor: ReactEditor, domNode: Node): NodeEntry | undefined {
  try {
    if (ReactEditor.hasDOMNode(editor, domNode)) {
      const node = ReactEditor.toSlateNode(editor, domNode)
      const path = ReactEditor.findPath(editor, node)


      return [node, path]
    }
  } catch (error) {
    console.warn(error)
  }

  return undefined
}

/**
 * Extract a decorated text range in it's parent node. The range can then be
 * used to perform text manipulation on the text node.
 *
 * Used to extract a range for a string that in turn can be used to replace a
 * misspelled word or string. (As decorations are fleeting and not persisted they
 * are rendered as a leaf children in their parent text leaf.)
 *
 * @fixme This might need to return a RangeRef to accomodate remote yjs changes.
 *
 * @param editor - Editor
 * @param x - number
 * @param y - number
 * @returns Range | undefined
 */
export function getDecorationRangeFromMouseEvent(editor: ReactEditor, event: MouseEvent): Range | undefined {
  let textNode: Node | undefined
  let offset: number | undefined

  if (document.caretPositionFromPoint) {
    const domPoint = document.caretPositionFromPoint(event.clientX, event.clientY) as { offsetNode: Node, offset: number } | null
    textNode = domPoint?.offsetNode
    offset = domPoint?.offset ?? 0
  } else if (document.caretRangeFromPoint) {
    // Fallback to deprecated function (mainly for Safari)
    const domRange = document.caretRangeFromPoint(event.clientX, event.clientY)
    textNode = domRange?.startContainer
    offset = domRange?.startOffset ?? 0
  } else {
    return
  }

  if (!textNode || textNode?.nodeType !== 3) {
    return
  }

  const slateRange = ReactEditor.findEventRange(editor, event)

  const ltr = slateRange.anchor.offset <= slateRange.focus.offset
  const length = textNode.nodeValue?.length || 0

  return {
    anchor: {
      path: slateRange.anchor.path,
      offset: slateRange.anchor.offset + (ltr ? -offset : length - offset)
    },
    focus: {
      path: slateRange.focus.path,
      offset: slateRange.focus.offset + (ltr ? length - offset : -offset)
    }
  }
}
