import { Element, type Editor } from 'slate'
import { ReactEditor } from 'slate-react'
import type { PluginDefinition } from '../types'
import { TextbitPlugin } from './textbit-plugin'

type Box = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>

export type DropBlock = {
  /** The block's index among the editor's top level nodes */
  at: number
  box: Box
  /** The block's plugin accepts drops onto the block itself */
  droppable: boolean
}

export type DropTarget = {
  /** Where a drop goes: before the top level block at this index, or last */
  index: number
  /** The line between two blocks to show, in viewport coordinates */
  line?: { top: number, left: number, width: number }
  /** A block that accepts drops onto itself, when the pointer is over its middle */
  around?: Box
}

/**
 * Where a drop at the vertical position y goes, given the boxes of the top
 * level blocks in document order.
 *
 * Every boundary between two blocks is one drop position, and its line is
 * drawn halfway through the gap between them. Whatever margins or padding
 * the blocks have, "below block A" and "above block B" are the same place.
 * A pointer in a gap belongs to that gap's boundary; a pointer over a block
 * to the nearer of its two boundaries.
 */
export function findDropTarget(blocks: DropBlock[], y: number): DropTarget {
  if (!blocks.length) {
    return { index: 0 }
  }

  // The boundary as a position in blocks: before blocks[b], or after the last
  const i = blocks.findIndex((block) => y < block.box.bottom)
  let b: number
  let around: Box | undefined

  if (i === -1) {
    b = blocks.length
  } else if (y < blocks[i].box.top) {
    b = i
  } else {
    const { box, droppable } = blocks[i]
    const height = box.bottom - box.top
    const share = height > 0 ? (y - box.top) / height : 0
    b = share < 0.5 ? i : i + 1
    if (droppable && share > 0.2 && share < 0.8) {
      around = box
    }
  }

  const index = b < blocks.length ? blocks[b].at : blocks[blocks.length - 1].at + 1
  return around ? { index, around } : { index, line: lineAt(blocks, b) }
}

function lineAt(blocks: DropBlock[], index: number): DropTarget['line'] {
  const above = blocks[index - 1]?.box
  const below = blocks[index]?.box
  const neighbours = [above, below].filter((box): box is Box => !!box)
  const left = Math.min(...neighbours.map((box) => box.left))
  const right = Math.max(...neighbours.map((box) => box.right))

  const top = above && below
    ? (above.bottom + below.top) / 2
    : above ? above.bottom : below!.top

  return { top, left, width: right - left }
}

/** The drop target at the vertical position y in the editor */
export function dropTargetAt(editor: Editor, plugins: PluginDefinition[], y: number): DropTarget {
  const blocks: DropBlock[] = []

  for (const [at, node] of editor.children.entries()) {
    if (!Element.isElement(node)) {
      continue
    }
    let box: DOMRect
    try {
      box = ReactEditor.toDOMNode(editor, node).getBoundingClientRect()
    } catch {
      // Not rendered yet
      continue
    }
    const plugin = plugins.find((p) => p.name === node.type)
    blocks.push({
      at,
      box,
      droppable: TextbitPlugin.isElementPlugin(plugin) && !!plugin.componentEntry?.droppable
    })
  }

  return findDropTarget(blocks, y)
}
