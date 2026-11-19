import { consumeFilesFor } from '../../../utils/consumeFiles'
import { Editor, Element, Range, Transforms } from 'slate'
import type { PluginRegistryAction } from '../../../contexts/PluginRegistry/lib/types'
import { toggleLeaf } from '../../../utils/toggleLeaf'
import type { AdjacentBlockState } from '../../../contexts/AdjacentBlockContext'
import type { BlockSelectionState } from '../../../contexts/BlockSelectionContext'
import { handleArrowWithAdjacentBlock, handleArrowNoAdjacentBlock, handleVerticalArrowWithAdjacentBlock } from './arrowHandlers'
import { handleNonArrowWithAdjacentBlock } from './nonArrowHandler'
import { enterBlockFromEnd, enterBlockFromStart, isAtAccessibleEnd, isAtAccessibleStart } from './blockUtils'
import { caretOnEdgeLine } from './caretOnEdgeLine'
import {
  enterBlockSelectionFromAdjacentCaret,
  enterBlockSelectionFromShiftArrow,
  handleBlockSelectionKeyDown
} from './blockSelectionHandler'
import { typesCharacter } from '../../../utils/menuKeyboard'

/*
 * Match key events to registered actions keyboard shortcuts. Then either
 * 1. call their action handler
 * 2. toggle leafs on or off
 * 3. transform text nodes to another type
 */
export function handleOnKeyDown(
  editor: Editor,
  actions: PluginRegistryAction[],
  event: React.KeyboardEvent<HTMLDivElement>,
  adjacentBlock: AdjacentBlockState | null,
  setAdjacentBlock: (state: AdjacentBlockState | null) => void,
  blockSelection: BlockSelectionState | null,
  setBlockSelection: (state: BlockSelectionState | null) => void
) {
  // 1. Block selection active — delegate all keys to block selection handler
  if (blockSelection) {
    handleBlockSelectionKeyDown(editor, event, blockSelection, setBlockSelection, setAdjacentBlock)
    return
  }

  // 2. Adjacent caret + Shift+Arrow — enter block selection mode
  if (adjacentBlock && event.shiftKey
    && (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    const newSelection = enterBlockSelectionFromAdjacentCaret(editor, event, adjacentBlock)
    if (newSelection) {
      event.preventDefault()
      setAdjacentBlock(null)
      setBlockSelection(newSelection)
    }
    return
  }

  // 3. Shift+Arrow onto an object, or out of the one the selection ends in:
  // select it
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const newSelection = enterBlockSelectionFromShiftArrow(editor, event)
    if (newSelection) {
      event.preventDefault()
      setBlockSelection(newSelection)
      return
    }
  }

  const key = event.key
  const goingForward = key === 'ArrowRight' // || key === 'ArrowDown'
  const goingBackward = key === 'ArrowLeft' // || key === 'ArrowUp'
  const isArrowKey = goingForward || goingBackward

  if (isArrowKey) {
    const { selection } = editor

    if (!selection || !Range.isCollapsed(selection)) {
      if (adjacentBlock) setAdjacentBlock(null)
      return
    }

    const { anchor } = selection
    const topLevelIndex = anchor.path[0]

    if (adjacentBlock) {
      // All paths inside handleArrowWithAdjacentBlock call event.preventDefault() and return
      handleArrowWithAdjacentBlock(
        editor,
        event,
        adjacentBlock,
        setAdjacentBlock,
        goingForward,
        goingBackward
      )
      return
    }

    // No adjacent state — check if an intermediate step is needed
    const handled = handleArrowNoAdjacentBlock(
      editor,
      event,
      setAdjacentBlock,
      goingForward,
      goingBackward,
      topLevelIndex,
      anchor
    )
    if (handled) return

    // Not at a block boundary — fall through to action loop
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    // With a modifier the key is the browser's, or a shortcut's: Shift extends
    // the selection, Alt, Cmd and Ctrl move by paragraph or to an end
    const modified = event.shiftKey || event.altKey || event.metaKey || event.ctrlKey

    if (adjacentBlock && !modified) {
      handleVerticalArrowWithAdjacentBlock(editor, event, adjacentBlock, setAdjacentBlock)
      return
    }
    if (adjacentBlock) {
      setAdjacentBlock(null)
    }

    // No indicator active: guard against Slate losing the selection when the
    // caret is at the edge of a non-text block at the top or bottom of the document.
    const { selection } = editor
    if (selection && Range.isCollapsed(selection)) {
      const { anchor } = selection
      const topLevelIndex = anchor.path[0]
      const currentBlock = editor.children[topLevelIndex]

      // Leaving a text block towards a void block, such as an object whose
      // plugin is missing: the browser would skip it, having nowhere to put
      // the caret. Park the block caret beside it, as Left and Right do.
      const down = key === 'ArrowDown'
      const neighborIndex = down ? topLevelIndex + 1 : topLevelIndex - 1
      const neighbor = editor.children[neighborIndex]
      if (!modified && Element.isElement(currentBlock) && currentBlock.class === 'text'
        && Element.isElement(neighbor) && editor.isVoid(neighbor) && neighbor.id
        && caretOnEdgeLine(editor, anchor, [topLevelIndex], down)) {
        event.preventDefault()
        if (down) {
          enterBlockFromStart(editor, [neighborIndex], neighbor)
        } else {
          enterBlockFromEnd(editor, [neighborIndex], neighbor)
        }
        setAdjacentBlock({ blockId: neighbor.id, direction: down ? 'before' : 'after' })
        return
      }

      if (Element.isElement(currentBlock) && currentBlock.class !== 'text') {
        if (key === 'ArrowDown'
          && topLevelIndex === editor.children.length - 1
          && isAtAccessibleEnd(editor, anchor, topLevelIndex)) {
          event.preventDefault()
          return
        }
        if (key === 'ArrowUp'
          && topLevelIndex === 0
          && isAtAccessibleStart(editor, anchor, topLevelIndex)) {
          event.preventDefault()
          return
        }
      }
    }
  } else if (adjacentBlock) {
    const handled = handleNonArrowWithAdjacentBlock(
      editor,
      event,
      adjacentBlock,
      setAdjacentBlock,
      actions
    )
    if (handled) return
  }

  // AltGr reaches the page as Ctrl+Alt on Windows: AltGr+2 types @ on a
  // Swedish keyboard and would otherwise trigger a ctrl+alt+2 shortcut
  if (event.ctrlKey && event.altKey && typesCharacter(event.nativeEvent ?? event)) {
    return
  }

  for (const action of actions) {
    if (!action.isHotkey(event)) {
      continue
    }

    // Not this action's context: let the next action with the same key try
    if (action.when && !action.when(editor)) {
      continue
    }

    if (action.handler) {
      const allowDefault = action.handler({
        editor,
        event,
        consumeFiles: consumeFilesFor(editor),
        type: action.plugin.name,
        options: {
          ...action.plugin.options
        }
      })

      if (!allowDefault) {
        break
      }
    }

    if (action.plugin.class === 'leaf') {
      event.preventDefault()
      toggleLeaf(editor, action.plugin.name)
    } else if (action.plugin.class === 'text') {
      event.preventDefault()
      // FIXME: Should not allow transforming blocks (only text class element)
      Transforms.setNodes(
        editor,
        { type: action.plugin.name },
        { match: (n) => Element.isElement(n) && Editor.isBlock(editor, n) }
      )
    }

    break
  }
}
