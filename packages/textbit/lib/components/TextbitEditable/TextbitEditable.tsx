import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, Element, Node, type NodeEntry, Path, Range, Text, Transforms } from 'slate'
import { Editable, ReactEditor, useFocused, useSlateSelector, type RenderElementProps, type RenderLeafProps } from 'slate-react'
import { getDecorationRanges } from '../../utils/getDecorationRanges'
import { useAgentChanges } from '../../hooks/useAgentChanges'
import { useSuggestionPlacement } from '../../hooks/useSuggestions'
import { AgentAnnouncer } from './AgentAnnouncer'
import { YjsEditor } from '@slate-yjs/core'
import { ElementComponent } from '../Element/Element'
import { LeafElement } from '../Element/LeafElement'
import { usePluginRegistry } from '../../hooks/usePluginRegistry'
import { useTextbit } from '../../hooks/useTextbit'
import { useContextMenu, type ContextMenuMode } from '../../hooks/useContextMenu'
import { useSlateStatic } from 'slate-react'
import { DragStateProvider } from '../../contexts/DragStateProvider'
import { PendingDropsProvider } from '../../contexts/PendingDropsProvider'
import { PresenceOverlay } from '../PresenceOverlay'
import type { Decoration, SpellcheckLookupTable, SpellingError } from '../../types'
import { SelectionBoundsDetails } from '../SelectionBoundsDetails'
import { type AdjacentBlockState } from '../../contexts/AdjacentBlockContext'
import { AdjacentBlockProvider } from '../../contexts/AdjacentBlockProvider'
import { type BlockSelectionState } from '../../contexts/BlockSelectionContext'
import { BlockSelectionProvider } from '../../contexts/BlockSelectionProvider'
import { handleOnKeyDown } from './handleOnKeyDown/handleOnKeyDown'
import { handleBlockSelectionKeyDown, syncSlateSelection } from './handleOnKeyDown/blockSelectionHandler'
import { scrollSelectionIntoView } from './scrollSelectionIntoView'
import { listenForBlockCaret } from '../../utils/blockCaret'
import { focusOutsideEditor, objectControls } from './objectFocus'
import { enterBlockFromEnd, enterBlockFromStart } from './handleOnKeyDown/blockUtils'
import { trimWhitespace } from '../../utils/trimWhitespace'
import { prepareBlockAwarePaste } from '../../utils/blockAwarePaste'

/** What `Textbit.Editable` takes */
export interface TextbitEditableProps {
  /** Focus the editor when it mounts: `true` or `'start'` at the start, `'end'` at the end. Default: `false`. */
  autoFocus?: boolean | 'start' | 'end'
  /** Called when the editor gets focus */
  onFocus?: React.FocusEventHandler<HTMLDivElement>
  /** Called when the editor loses focus */
  onBlur?: React.FocusEventHandler<HTMLDivElement>
  /** Rules for all text in this editor */
  constraints?: {
    /** Whether text may start or end with whitespace; trailing whitespace is trimmed on blur when not. Default: `true`. */
    allowEdgeWhitespace?: boolean
  }
  /** A class on the editable element */
  className?: string
  /** A style on the editable element */
  style?: React.CSSProperties
  /** What goes with the editable: toolbar, context menu, markers */
  children?: React.ReactNode
  /** The editable's accessible name, e.g. `Article`. Give one: screen readers announce it. */
  'aria-label'?: string
  /**
   * Answer whether a reported spelling error is accepted for this document.
   * Must be memoized - it takes part in the decorate callback identity.
   */
  isSpellingAccepted?: (error: SpellingError) => boolean
  /**
   * Highlight ranges of text. Each leaf a decoration covers renders with the
   * class `tb-mark` and `data-tb-mark` listing the ids of all decorations on it.
   * Ranges are not tracked through edits: the caller keeps them fresh against
   * the current document. Must be memoized - it takes part in the decorate
   * callback identity.
   */
  decorations?: readonly Decoration[]
  /**
   * When the context menu opens: only on misspelled words (default), or on
   * any text so it can offer other actions too.
   */
  contextMenu?: ContextMenuMode
}

/**
 * Where the document is edited. Goes inside `Textbit.Root`, with the
 * toolbar, context menu and markers as its children.
 *
 * ```tsx
 * <Textbit.Editable aria-label='Article' autoFocus='end'>
 *   <Toolbar.Root>…</Toolbar.Root>
 *   <Textbit.DropMarker />
 * </Textbit.Editable>
 * ```
 */
export function TextbitEditable(props: TextbitEditableProps) {
  const editor = useSlateStatic()
  const { placeholders, placeholder, readOnly, dir, collaborative, verbose } = useTextbit()
  const { components, actions } = usePluginRegistry()
  const registeredTypes = useMemo(() => new Set(components.keys()), [components])
  const isFocused = useFocused()
  const handleContextMenu = useContextMenu(true, props.contextMenu)
  const [spellingLookupTable, setSpellingLookupTable] = useState<SpellcheckLookupTable>(new Map())
  const [adjacentBlock, setAdjacentBlock] = useState<AdjacentBlockState | null>(null)
  const [blockSelection, setBlockSelection] = useState<BlockSelectionState | null>(null)
  const {
    onFocus,
    onBlur,
    constraints,
    autoFocus = false,
    isSpellingAccepted,
    decorations
  } = props

  useEffect(() => {
    editor.allowEdgeWhitespace = constraints?.allowEdgeWhitespace !== false
  }, [editor, constraints?.allowEdgeWhitespace])

  // Track mounted state
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Tracks whether a mousedown happened immediately before the focus event.
  // A click flow is mousedown -> focus; Tab and programmatic focus are not
  // preceded by a mousedown. This lets us tell them apart inside handleFocus.
  const focusFromMouseRef = useRef(false)

  // True from a mousedown in the editor until just after the mouseup, so a
  // selection the click makes is not scrolled to. Cleared by any key too.
  const fromPointerRef = useRef(false)
  useEffect(() => {
    const release = () => setTimeout(() => {
      fromPointerRef.current = false
    })
    document.addEventListener('mouseup', release, true)
    return () => document.removeEventListener('mouseup', release, true)
  }, [])

  const scrollSelection = useCallback((_: ReactEditor, domRange: globalThis.Range) => {
    scrollSelectionIntoView(editor, domRange, fromPointerRef.current)
  }, [editor])

  // Place an initial caret when the editor gains focus via Tab, autoFocus, or
  // programmatic focus without a prior selection. Clicks are left alone: the
  // browser places the DOM caret on mousedown, and slate-react's
  // selectionchange handler syncs that to editor.selection shortly after.
  const handleFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const fromMouse = focusFromMouseRef.current
    focusFromMouseRef.current = false

    queueMicrotask(() => {
      if (fromMouse || editor.selection) {
        return
      }

      Transforms.select(
        editor,
        autoFocus === 'end' ? Editor.end(editor, []) : Editor.start(editor, [])
      )
    })

    onFocus?.(e)
  }, [editor, autoFocus, onFocus])

  useEffect(() => {
    if (typeof editor.onSpellcheckComplete !== 'function') {
      return
    }

    editor.onSpellcheckComplete((newLookupTable) => {
      if (!isMountedRef.current) {
        return
      }

      setSpellingLookupTable(newLookupTable)
    })
  }, [editor])

  // Render element callback
  const renderElement = useCallback((props: RenderElementProps) => {
    return ElementComponent({
      ...props
    })
  }, [])

  // Render leaf callback
  const renderLeaf = useCallback((props: RenderLeafProps) => {
    return LeafElement(props)
  }, [])

  // Track editor emptiness so the global 'single' placeholder turns off as
  // soon as content appears anywhere — even on a non-first block. Threading
  // this through the decorate dep list also flips the callback's identity
  // on emptiness change, which is what makes slate-react's per-element
  // decoration cache (useDecorations) re-invoke our decorator for unchanged
  // blocks like a leading empty one.
  const editorIsEmpty = useSlateSelector(
    (e) => e.children.every((c) => Node.string(c) === '')
  )

  // What agents changed, shown in the text
  const { changes: agentChanges } = useAgentChanges()
  // What is suggested, shown in the text
  const { onBlock: suggestionsOnBlock } = useSuggestionPlacement()

  // Render decorate callback
  const decorate = useCallback((entry: NodeEntry) => {
    return getDecorationRanges(
      editor,
      spellingLookupTable,
      entry,
      components,
      placeholders,
      placeholder,
      editorIsEmpty,
      isSpellingAccepted,
      decorations,
      agentChanges,
      suggestionsOnBlock
    )
  }, [
    editor,
    components,
    placeholders,
    placeholder,
    spellingLookupTable,
    editorIsEmpty,
    isSpellingAccepted,
    decorations,
    agentChanges,
    suggestionsOnBlock
  ])

  const handleBlur = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    if (constraints?.allowEdgeWhitespace !== false) {
      onBlur?.(e)
      return
    }

      // queueMicrotask schedules a function to run after the current JavaScript task finishes,
      // so it's added here to give Slate a chance to handle timing issues
      queueMicrotask(() => {
        trimWhitespace({ editor })
      })

    onBlur?.(e)
  }, [editor, constraints, onBlur])

  /**
   * Tab in reading order. A block caret before an object, its controls (such
   * as its buttons) and a block caret after it are three stops: Tab steps
   * forward through them, Shift+Tab back. A selected object's controls are the
   * next stop either way. From anywhere else Tab leaves the editor, skipping
   * every object's controls. Returns whether it handled the key.
   */
  const tabFromBlock = useCallback((event: React.KeyboardEvent<HTMLDivElement>): boolean => {
    const forward = !event.shiftKey
    let index = -1
    if (blockSelection && blockSelection.anchorIndex === blockSelection.focusIndex) {
      index = blockSelection.anchorIndex
    } else if (adjacentBlock && (adjacentBlock.direction === 'before') === forward) {
      index = editor.children.findIndex((c) => Element.isElement(c) && c.id === adjacentBlock.blockId)
    }

    const controls = index === -1 ? [] : objectControls(editor, index)
    event.preventDefault()
    if (adjacentBlock) setAdjacentBlock(null)
    if (blockSelection) setBlockSelection(null)

    if (controls.length) {
      (forward ? controls[0] : controls[controls.length - 1]).focus()
    } else {
      focusOutsideEditor(editor, forward)
    }
    return true
  }, [editor, adjacentBlock, blockSelection, setAdjacentBlock, setBlockSelection])

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    fromPointerRef.current = false

    const isTab = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey
    if (isTab && (adjacentBlock || blockSelection)) {
      tabFromBlock(event)
      return
    }

    // slate-react passes keys on in a read-only editor too: only selecting
    // and copying whole blocks, and nothing that changes the document
    if (readOnly) {
      if (blockSelection) {
        handleBlockSelectionKeyDown(editor, event, blockSelection, setBlockSelection, setAdjacentBlock, true)
      }
      if (isTab) {
        event.preventDefault()
        focusOutsideEditor(editor, !event.shiftKey)
      }
      return
    }

    handleOnKeyDown(editor, actions, event, adjacentBlock, setAdjacentBlock, blockSelection, setBlockSelection)

    // Tab no plugin used, such as a table's or a code block's, leaves the editor
    if (isTab && !event.defaultPrevented) {
      event.preventDefault()
      focusOutsideEditor(editor, !event.shiftKey)
    }
  }, [editor, actions, readOnly, adjacentBlock, setAdjacentBlock, blockSelection, setBlockSelection, tabFromBlock])

  // Keys in an object's controls, such as its buttons, which slate-react does
  // not pass on. Escape selects the object. Tab on the last control parks the
  // block caret after it, Shift+Tab on the first before it. A native listener
  // on the editor's element: keys in a dialog an object opened elsewhere in
  // the page do not reach it, though React would pass them through the object.
  useEffect(() => {
    let root: HTMLElement
    try {
      root = ReactEditor.toDOMNode(editor, editor)
    } catch {
      return
    }

    const onControlKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (event.defaultPrevented || !target || target.isContentEditable || target === root) {
        return
      }
      const index = objectIndexOf(editor, target)
      if (index === null) {
        return
      }
      const block = editor.children[index]
      if (!Element.isElement(block) || !block.id) {
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        const state = { anchorIndex: index, focusIndex: index }
        setAdjacentBlock(null)
        setBlockSelection(state)
        syncSlateSelection(editor, state)
        focusEditor()
        return
      }

      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) {
        return
      }
      const controls = objectControls(editor, index)
      const position = controls.indexOf(target)
      const leaving = event.shiftKey ? position === 0 : position === controls.length - 1
      if (position === -1 || !leaving) {
        return
      }

      event.preventDefault()
      setBlockSelection(null)
      if (event.shiftKey) {
        enterBlockFromStart(editor, [index], block)
      } else {
        enterBlockFromEnd(editor, [index], block)
      }
      setAdjacentBlock({ blockId: block.id, direction: event.shiftKey ? 'before' : 'after' })
      focusEditor()
    }

    // slate-react counts focus on a control inside the editor as the editor's,
    // so ReactEditor.focus alone would leave it on the control
    const focusEditor = () => {
      root.focus({ preventScroll: true })
      ReactEditor.focus(editor)
    }

    root.addEventListener('keydown', onControlKeyDown)
    return () => root.removeEventListener('keydown', onControlKeyDown)
  }, [editor, setAdjacentBlock, setBlockSelection])

  /**
   * A click on an object (a non-text block such as an image or a factbox)
   * outside its text selects the whole object, as the keyboard does, so a copy
   * carries it in full. Shift extends a block selection to it. Handled on click,
   * not mousedown: plugins often stop mousedown, and dragging an object fires no
   * click. Returning true makes slate-react skip its own void click handling.
   */
  const onClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const index = objectIndexAt(editor, event.target)
    if (index === null) {
      return false
    }

    ReactEditor.focus(editor)
    setAdjacentBlock(null)
    const state = event.shiftKey && blockSelection
      ? { anchorIndex: blockSelection.anchorIndex, focusIndex: index }
      : { anchorIndex: index, focusIndex: index }
    setBlockSelection(state)
    syncSlateSelection(editor, state)
    event.preventDefault()
    return true
  }, [editor, blockSelection, setAdjacentBlock, setBlockSelection])

  // A paste places a block caret after an object it inserts
  useEffect(() => listenForBlockCaret(editor, (blockId) => {
    setBlockSelection(null)
    setAdjacentBlock(blockId ? { blockId, direction: 'after' } : null)
  }), [editor, setAdjacentBlock, setBlockSelection])

  // A read-only editor does not put its selection in the page itself, and a
  // copy needs one there: give it the block selection
  useEffect(() => {
    if (!readOnly || !blockSelection || !editor.selection) {
      return
    }
    try {
      const range = ReactEditor.toDOMRange(editor, editor.selection)
      const domSelection = ReactEditor.getWindow(editor).getSelection()
      domSelection?.removeAllRanges()
      domSelection?.addRange(range)
    } catch {
      // Not rendered yet
    }
  }, [readOnly, blockSelection, editor])

  /**
   * Redirect paste when block caret or block selection is active so the
   * clipboard content lands adjacent to (or replaces) the affected
   * block(s), rather than inside the block the hidden Slate selection
   * happens to point at. See utils/blockAwarePaste.ts for details.
   */
  const onPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    // slate-react passes paste on in a read-only editor too
    if (readOnly) {
      event.preventDefault()
      return
    }

    if (!adjacentBlock && !blockSelection) {
      return
    }

    const data = event.clipboardData
    if (!data) {
      return
    }

    const result = prepareBlockAwarePaste(editor, data, adjacentBlock, blockSelection, registeredTypes)

    if (result === 'unhandled') {
      return
    }

    // Nothing on the clipboard this editor can insert: change nothing
    if (result === 'empty') {
      event.preventDefault()
      return
    }

    // A direct insert placed the caret, block caret included, through
    // listenForBlockCaret. Otherwise the editor is now in a normal
    // collapsed-selection state.
    if (result === 'prepared') {
      if (adjacentBlock) setAdjacentBlock(null)
      if (blockSelection) setBlockSelection(null)
    }

    if (result === 'handled') {
      // Slate fragment was inserted directly — stop slate-react from also
      // running its default paste handler.
      event.preventDefault()
    }
    // For 'prepared' we leave the event alone so slate-react's default
    // paste handler populates the placeholder via editor.insertData.
  }, [editor, readOnly, adjacentBlock, blockSelection, setAdjacentBlock, setBlockSelection, registeredTypes])

  /**
   * A click beside a top-level non-text block, such as an image or a table,
   * parks a block caret before or after it rather than letting Slate try to
   * resolve a position outside any editable text. Returns whether it did.
   */
  const parkBesideBlock = useCallback((clickX: number, clickY: number): boolean => {
    const beside = blockBeside(editor, clickX, clickY)
    if (!beside) {
      return false
    }

    const { index, block, direction } = beside
    if (!block.id) {
      return false
    }
    ReactEditor.focus(editor)

    // Keep the selection inside the clicked block so useSelected() stays true
    // only for this block (prevents focus rings on neighbouring blocks).
    if (direction === 'before') {
      Transforms.select(editor, Editor.start(editor, [index]))
    } else {
      Transforms.select(editor, Editor.end(editor, [index]))
    }
    setAdjacentBlock({ blockId: block.id, direction })
    if (blockSelection) {
      setBlockSelection(null)
    }
    return true
  }, [editor, setAdjacentBlock, blockSelection, setBlockSelection])

  // The room beside blocks is often outside the editable text: the editor's
  // padding and the gutter. Clicks there park a block caret too, unless they
  // land on something of its own, like the gutter menu.
  useEffect(() => {
    let root: HTMLElement | null = null
    try {
      const editable = ReactEditor.toDOMNode(editor, editor)
      root = editable.closest<HTMLElement>('[data-tb="editor"]')
    } catch {
      return
    }
    if (!root || readOnly) {
      return
    }

    const onRootMouseDown = (event: MouseEvent) => {
      const target = event.target instanceof globalThis.Element ? event.target : null
      if (event.button !== 0 || !target || target.closest('[data-slate-editor]') || target.closest(INTERACTIVE)) {
        return
      }
      fromPointerRef.current = true
      if (parkBesideBlock(event.clientX, event.clientY)) {
        event.preventDefault()
      }
    }

    root.addEventListener('mousedown', onRootMouseDown)
    return () => root.removeEventListener('mousedown', onRootMouseDown)
  }, [editor, readOnly, parkBesideBlock])

  /**
   * Fixefox does not set the caret position correctly when clicking
   * in an unfocused Editable area. If the gecko rendering engine is
   * detected we help the user by setting the caret position.
   *
   * Also handles clicks in the editable beside non-text blocks.
   */
  const onMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // Signal to handleFocus that the upcoming focus event came from a click.
    focusFromMouseRef.current = true
    fromPointerRef.current = true

    // Shift+click on an object extends the block selection on click: keep it,
    // and keep the browser from extending a text selection meanwhile
    if (event.shiftKey && blockSelection && objectIndexAt(editor, event.target) !== null) {
      event.preventDefault()
      return
    }

    if (parkBesideBlock(event.clientX, event.clientY)) {
      event.preventDefault()
      return
    }

    // Default: clear adjacent block and block selection state on any other click
    if (adjacentBlock) {
      setAdjacentBlock(null)
    }
    if (blockSelection) {
      setBlockSelection(null)
    }

    // Coming back from elsewhere with a block selection or block caret still
    // set: the selection still spans that block, and clearing the state makes
    // slate-react restore it as the editor regains focus, over the caret the
    // click places. Put the selection at the click instead.
    if (!isFocused && (adjacentBlock || blockSelection)) {
      try {
        const range = ReactEditor.findEventRange(editor, event)
        if (Range.isRange(range)) {
          Transforms.select(editor, range)
          return
        }
      } catch {
        // The click is not on text; the browser places the caret
      }
    }

    // We only need to handle this for Firefox (Gecko rendering engine)
    if (!navigator.userAgent.includes('Gecko/')) {
      return
    }

    if (!isFocused) {
      const range = ReactEditor.findEventRange(editor, event)
      if (Range.isRange(range)) {
        Transforms.select(editor, range)
      }
    }
  }, [editor, isFocused, adjacentBlock, setAdjacentBlock, blockSelection, setBlockSelection, parkBesideBlock])

  return (
    <>
<BlockSelectionProvider value={blockSelection}>
        <AdjacentBlockProvider value={adjacentBlock} setValue={setAdjacentBlock}>
          <DragStateProvider>
            <PendingDropsProvider editor={editor}>
              <PresenceOverlay isCollaborative={collaborative}>
                <Editable
                  autoFocus={!!autoFocus}
                  data-tb='editable'
                  data-state={isFocused ? 'focused' : ''}
                  readOnly={readOnly}
                  renderElement={renderElement}
                  renderLeaf={renderLeaf}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  decorate={decorate}
                  className={props.className}
                  style={adjacentBlock || blockSelection
                    ? { ...props.style, caretColor: 'transparent' }
                    : props.style
                  }
                  spellCheck={false}
                  dir={dir}
                  onContextMenu={handleContextMenu}
                  onMouseDown={onMouseDown}
                  onClick={onClick}
                  scrollSelectionIntoView={scrollSelection}
                  aria-label={props['aria-label']}
                />
                {props.children}
                {(YjsEditor.isYjsEditor(editor) || suggestionsOnBlock.size > 0) && <AgentAnnouncer />}
              </PresenceOverlay>
            </PendingDropsProvider>
          </DragStateProvider>
        </AdjacentBlockProvider>
      </BlockSelectionProvider>

      {verbose && <SelectionBoundsDetails />}
    </>
  )
}

/** Things in the editor's surface a click must reach, not park a block caret */
const INTERACTIVE = 'button, a, input, textarea, select, label, [role="button"], [role="menu"], [role="menuitem"], [data-tb="menu"], [data-tb="toolbar"]'

/** The top-level non-text block a click at (x, y) is beside, and on which side */
function blockBeside(editor: Editor, x: number, y: number): {
  index: number
  block: Element
  direction: 'before' | 'after'
} | null {
  for (const [index, block] of editor.children.entries()) {
    if (!Element.isElement(block) || block.class === 'text') {
      continue
    }

    let rect: DOMRect
    try {
      rect = ReactEditor.toDOMNode(editor, block).getBoundingClientRect()
    } catch {
      continue
    }

    if (y < rect.top || y > rect.bottom || (x >= rect.left && x <= rect.right)) {
      continue
    }

    return { index, block, direction: x < (rect.left + rect.right) / 2 ? 'before' : 'after' }
  }
  return null
}

/** Controls inside an object a click must reach, not select the object */
const OBJECT_CONTROLS = 'button, input, textarea, select, a[href], [role="button"]'

/**
 * The index of the top-level object a click at this target selects, or null.
 * It has to be in this editor (React events also bubble out of portals such as
 * a dialog an object opens), outside the object's controls and text, on a
 * node that still exists, and the object must not be a text block.
 */
function objectIndexAt(editor: Editor, target: EventTarget): number | null {
  if (!(target instanceof globalThis.Node) || !ReactEditor.hasDOMNode(editor, target)) {
    return null
  }
  const element = target instanceof globalThis.Element ? target : target.parentElement
  if (!element || element.closest(OBJECT_CONTROLS)) {
    return null
  }

  let node: Node
  let path: Path
  try {
    node = ReactEditor.toSlateNode(editor, element)
    path = ReactEditor.findPath(editor, node)
  } catch {
    return null
  }
  if (!Node.has(editor, path) || Node.get(editor, path) !== node) {
    return null
  }

  const top = editor.children[path[0]]
  if (!Element.isElement(top) || top.class === 'text') {
    return null
  }

  // The closest element at the target: the object itself, or a void in it
  const closestPath = Text.isText(node) ? Path.parent(path) : path
  const closest = Node.get(editor, closestPath)
  if (!Element.isElement(closest)) {
    return null
  }
  return closestPath.length === 1 || Editor.isVoid(editor, closest) ? path[0] : null
}

/** The top-level object holding a DOM element in this editor, or null */
function objectIndexOf(editor: Editor, target: HTMLElement): number | null {
  try {
    const node = ReactEditor.toSlateNode(editor, target)
    const path = ReactEditor.findPath(editor, node)
    const top = editor.children[path[0]]
    return Element.isElement(top) && top.class !== 'text' ? path[0] : null
  } catch {
    return null
  }
}

