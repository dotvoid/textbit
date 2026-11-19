import { Editor, Element, Path, type Point, Range, Transforms } from 'slate'
import type { AdjacentBlockState } from '../../../contexts/AdjacentBlockContext'
import type { BlockSelectionState } from '../../../contexts/BlockSelectionContext'
import {
  resolveTargetIndex,
  enterBlockFromStart,
  enterBlockFromEnd,
  firstEditableChildIdx,
  isAtAccessibleEnd,
  isAtAccessibleStart,
  lastEditableChildIdx
} from './blockUtils'
import { caretOnEdgeLine } from './caretOnEdgeLine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set the real Slate selection to span all blocks in the block-selection range.
 * This gives us native browser text highlighting and native clipboard copy.
 */
export function syncSlateSelection(editor: Editor, bs: BlockSelectionState): void {
  const lo = Math.min(bs.anchorIndex, bs.focusIndex)
  const hi = Math.max(bs.anchorIndex, bs.focusIndex)
  const last = editor.children[hi]
  Transforms.select(editor, {
    anchor: Editor.start(editor, [lo]),
    // Slate renders only a void's first text, so a selection that ends further
    // in cannot be shown or copied: a void, such as an object whose plugin is
    // missing, ends the selection at its start, and is still copied whole
    focus: Element.isElement(last) && Editor.isVoid(editor, last)
      ? Editor.start(editor, [hi])
      : Editor.end(editor, [hi])
  })
}

/**
 * Remove all blocks in the selection range, then place the cursor at
 * the appropriate position in the remaining document.
 */
function deleteSelectedBlocks(
  editor: Editor,
  blockSelection: BlockSelectionState,
  setBlockSelection: (state: BlockSelectionState | null) => void
): void {
  const lo = Math.min(blockSelection.anchorIndex, blockSelection.focusIndex)
  const hi = Math.max(blockSelection.anchorIndex, blockSelection.focusIndex)

  Editor.withoutNormalizing(editor, () => {
    for (let i = hi; i >= lo; i--) {
      Transforms.removeNodes(editor, { at: [i] })
    }
  })

  setBlockSelection(null)

  // Place cursor after deletion (Slate normalizer ensures ≥1 child)
  if (lo < editor.children.length) {
    Transforms.select(editor, Editor.start(editor, [lo]))
  } else if (editor.children.length > 0) {
    Transforms.select(editor, Editor.end(editor, [editor.children.length - 1]))
  }
}

// ---------------------------------------------------------------------------
// Entry from adjacent caret
// ---------------------------------------------------------------------------

/**
 * Called when `adjacentBlock` is active, `event.shiftKey` is true,
 * and key is ArrowUp/Down/Left/Right.
 *
 * Left behaves like Up, Right behaves like Down.
 * Returns the initial BlockSelectionState, or null if out of bounds.
 */
export function enterBlockSelectionFromAdjacentCaret(
  editor: Editor,
  event: React.KeyboardEvent<HTMLDivElement>,
  adjacentBlock: AdjacentBlockState
): BlockSelectionState | null {
  const targetIndex = resolveTargetIndex(editor, adjacentBlock)
  if (targetIndex === -1) return null

  const goingForward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
  const { direction } = adjacentBlock

  // Entry rules:
  // before + Up/Left    → select block above (targetIndex - 1)
  // before + Down/Right → select current block (targetIndex)
  // after  + Up/Left    → select current block (targetIndex)
  // after  + Down/Right → select block below (targetIndex + 1)
  let selectIndex: number

  if (direction === 'before' && !goingForward) {
    selectIndex = targetIndex - 1
  } else if (direction === 'before' && goingForward) {
    selectIndex = targetIndex
  } else if (direction === 'after' && !goingForward) {
    selectIndex = targetIndex
  } else {
    // direction === 'after' && goingForward
    selectIndex = targetIndex + 1
  }

  // Bounds check
  if (selectIndex < 0 || selectIndex >= editor.children.length) {
    return null
  }

  const state = { anchorIndex: selectIndex, focusIndex: selectIndex }
  syncSlateSelection(editor, state)
  return state
}

// ---------------------------------------------------------------------------
// Entry from a text selection
// ---------------------------------------------------------------------------

/**
 * Shift+Arrow that would take the selection onto an object, or out of the
 * object it ends in, selects the object instead: a block selection from the
 * block the selection starts in. Up and Down count from the first or last
 * line; with Alt, Cmd or Ctrl they jump further and are left to the browser.
 * Returns the block selection, or null to leave the key alone.
 */
export function enterBlockSelectionFromShiftArrow(
  editor: Editor,
  event: React.KeyboardEvent<HTMLDivElement>
): BlockSelectionState | null {
  const { selection } = editor
  const { key } = event
  const vertical = key === 'ArrowUp' || key === 'ArrowDown'
  if (!selection || !event.shiftKey || (vertical && (event.altKey || event.metaKey || event.ctrlKey))) {
    return null
  }

  const forward = key === 'ArrowDown' || key === 'ArrowRight'
  const { focus } = selection
  const index = focus.path[0]
  const block = editor.children[index]
  if (!Element.isElement(block)) {
    return null
  }

  let target = -1
  if (block.class !== 'text') {
    // Out of the object the selection ends in
    if (vertical ? onObjectEdgeLine(editor, focus, index, forward)
      : forward ? isAtAccessibleEnd(editor, focus, index) : isAtAccessibleStart(editor, focus, index)) {
      target = index
    }
  } else {
    // Onto the object beside the text block it ends in
    const neighborIndex = forward ? index + 1 : index - 1
    const neighbor = editor.children[neighborIndex]
    const onEdge = vertical ? caretOnEdgeLine(editor, focus, [index], forward)
      : forward ? Editor.isEnd(editor, focus, [index]) : Editor.isStart(editor, focus, [index])
    if (Element.isElement(neighbor) && neighbor.class !== 'text' && onEdge) {
      target = neighborIndex
    }
  }

  if (target === -1) {
    return null
  }

  const state = {
    anchorIndex: Range.isCollapsed(selection) ? target : selection.anchor.path[0],
    focusIndex: target
  }
  syncSlateSelection(editor, state)
  return state
}

/**
 * Whether a point is on the last line of an object's last field, or on the
 * first line of its first
 */
function onObjectEdgeLine(editor: Editor, point: Point, index: number, last: boolean): boolean {
  const block = editor.children[index]
  if (!Element.isElement(block)) {
    return false
  }
  const field = last ? lastEditableChildIdx(editor, block) : firstEditableChildIdx(editor, block)
  const path = field === -1 ? [index] : [index, field]
  return Path.isCommon(path, point.path) && caretOnEdgeLine(editor, point, path, last)
}

// ---------------------------------------------------------------------------
// Key handling while block selection is active
// ---------------------------------------------------------------------------

/**
 * Handles all key events while block selection is active.
 *
 * - Shift+Arrow: extend selection
 * - Unshifted arrow: collapse selection and exit
 * - Escape: exit to a caret after the last selected block
 * - Delete/Backspace: remove selected blocks
 * - Cmd/Ctrl+C: pass through for native copy
 * - Cmd/Ctrl+X: copy then delete blocks
 * - All other keys: consumed (no-op)
 */
export function handleBlockSelectionKeyDown(
  editor: Editor,
  event: React.KeyboardEvent<HTMLDivElement>,
  blockSelection: BlockSelectionState,
  setBlockSelection: (state: BlockSelectionState | null) => void,
  setAdjacentBlock: (state: AdjacentBlockState | null) => void,
  readOnly = false
): void {
  const key = event.key
  const isArrow = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight'
  const hasMod = event.metaKey || event.ctrlKey
  // Caps Lock and Shift make letters upper case: Ctrl+Shift+V pastes plain text
  const letter = key.length === 1 ? key.toLowerCase() : ''

  // ── Read-only: select and copy, never change the document ─────────────
  if (readOnly && !(event.shiftKey && isArrow)) {
    if (isArrow || key === 'Escape') {
      event.preventDefault()
      setBlockSelection(null)
    }
    return
  }

  // ── Shift+Arrow — extend selection ────────────────────────────────────
  if (event.shiftKey && isArrow) {
    event.preventDefault()
    const goingForward = key === 'ArrowDown' || key === 'ArrowRight'
    const lastIndex = editor.children.length - 1
    const newFocus = goingForward
      ? Math.min(blockSelection.focusIndex + 1, lastIndex)
      : Math.max(blockSelection.focusIndex - 1, 0)
    const newState = { ...blockSelection, focusIndex: newFocus }
    setBlockSelection(newState)
    syncSlateSelection(editor, newState)
    return
  }

  // ── Unshifted arrow — collapse selection ──────────────────────────────
  if (isArrow && !event.shiftKey) {
    event.preventDefault()

    const lo = Math.min(blockSelection.anchorIndex, blockSelection.focusIndex)
    const hi = Math.max(blockSelection.anchorIndex, blockSelection.focusIndex)

    // Up/Left → start of first selected block
    // Down/Right → end of last selected block
    const goingUp = key === 'ArrowUp' || key === 'ArrowLeft'
    const targetIndex = goingUp ? lo : hi
    const targetBlock = editor.children[targetIndex]

    setBlockSelection(null)

    if (Element.isElement(targetBlock) && targetBlock.class !== 'text') {
      // Non-text block: enter adjacent caret mode
      if (goingUp) {
        enterBlockFromStart(editor, [targetIndex], targetBlock)
        setAdjacentBlock({ blockId: targetBlock.id, direction: 'before' })
      } else {
        enterBlockFromEnd(editor, [targetIndex], targetBlock)
        setAdjacentBlock({ blockId: targetBlock.id, direction: 'after' })
      }
    } else {
      // Text block: place normal cursor
      if (goingUp) {
        Transforms.select(editor, Editor.start(editor, [targetIndex]))
      } else {
        Transforms.select(editor, Editor.end(editor, [targetIndex]))
      }
    }
    return
  }

  // ── Escape — leave, to a caret after the last selected block ──────────
  if (key === 'Escape') {
    event.preventDefault()
    const hi = Math.max(blockSelection.anchorIndex, blockSelection.focusIndex)
    const block = editor.children[hi]
    setBlockSelection(null)

    if (Element.isElement(block) && block.class !== 'text') {
      enterBlockFromEnd(editor, [hi], block)
      setAdjacentBlock({ blockId: block.id, direction: 'after' })
    } else {
      Transforms.select(editor, Editor.end(editor, [hi]))
    }
    return
  }

  // ── Delete / Backspace — remove selected blocks ───────────────────────
  if (key === 'Backspace' || key === 'Delete') {
    event.preventDefault()
    deleteSelectedBlocks(editor, blockSelection, setBlockSelection)
    return
  }

  // ── Cmd/Ctrl+C — let native copy pass through ────────────────────────
  // The Slate selection spans the selected blocks, so the browser/Slate
  // copy handler writes the correct fragment to the clipboard.
  if (hasMod && letter === 'c') {
    return
  }

  // ── Cmd/Ctrl+X — cut: copy then delete ────────────────────────────────
  if (hasMod && !event.shiftKey && letter === 'x') {
    // Trigger a synchronous copy via the deprecated-but-universal
    // execCommand; Slate's onCopy handler serialises the fragment.
    document.execCommand('copy')
    event.preventDefault()
    deleteSelectedBlocks(editor, blockSelection, setBlockSelection)
    return
  }

  // ── Cmd/Ctrl+V, and Shift for plain text — let the paste event fire ───
  // The onPaste handler on TextbitEditable consumes the block selection
  // state, removes the selected blocks and inserts the clipboard content
  // in their place. Do NOT preventDefault here.
  if (hasMod && letter === 'v') {
    return
  }

  // ── All other keys: consume, no-op ────────────────────────────────────
  event.preventDefault()
}
