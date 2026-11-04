import { getDecorationRangeFromMouseEvent, getNodeEntryFromDomNode } from '../utils/utils'
import { type MouseEventHandler, useContext, useMemo } from 'react'
import { Range, Editor, Element as SlateElement, Transforms } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { TextbitEditor } from '../utils/textbit-editor'
import { type SpellingError } from '../types/slate'
import { ContextMenuHintsContext } from '../components/ContextMenu/ContextMenuHintsContext'

/**
 * When the context menu opens. `spelling` only opens it on a misspelled word;
 * `always` opens it on any text, with `spelling` in the hints left undefined
 * when the word is not misspelled.
 */
export type ContextMenuMode = 'spelling' | 'always'

export function useContextMenu(
  preventDefault = true,
  mode: ContextMenuMode = 'spelling'
) {
  const editor = useSlateStatic()
  const contextMenuHintsContext = useContext(ContextMenuHintsContext)

  return useMemo(() => {

    const contextMenuHandler = (event: MouseEvent) => {
      // The Menu key (and Shift+F10 where the OS maps it) fires the event on
      // the editor itself rather than on the text, so use the text at the caret
      const fromKeyboard = isEditorRoot(editor, event.target)
      const targetElement = fromKeyboard
        ? caretElement(editor)
        : (event.target as Node).nodeType === Node.TEXT_NODE
          ? (event.target as Text).parentElement
          : (event.target as HTMLElement)

      if (!targetElement) {
        return
      }

      const nodeEntry = getNodeEntryFromDomNode(editor, targetElement)
      const [targetNode, targetPath] = nodeEntry || []

      if (!targetNode || !Array.isArray(targetPath)) {
        return
      }

      const topNode = editor.children[targetPath[0]]

      if (!SlateElement.isElement(topNode)) {
        return
      }

      const spelling = getSpellingHints(editor, topNode, targetElement, event)

      // On a misspelled word, select the word so a suggestion replaces it.
      // Anywhere else, put the caret where the user clicked - selecting the
      // whole text leaf there meant the next keystroke replaced all of it.
      // From the keyboard the caret is already where the user wants it.
      const range = fromKeyboard
        ? undefined
        : spelling
          ? getDecorationRangeFromMouseEvent(editor, event)
          : getCaretRangeFromMouseEvent(editor, event)
      if (range) {
        Transforms.select(editor, range)
        ReactEditor.focus(editor)
      }

      if (preventDefault) {
        event.preventDefault()
      }

      if (!spelling && mode === 'spelling') {
        return
      }

      contextMenuHintsContext?.dispatch({
        menu: {
          position: fromKeyboard
            ? caretPosition(editor) ?? { x: event.clientX, y: event.clientY }
            : { x: event.clientX, y: event.clientY },
          target: targetElement,
          originalEvent: event,
          nodeEntry: [targetNode, targetPath]
        },
        spelling
      })
    }

    return contextMenuHandler as unknown as MouseEventHandler<HTMLDivElement>
  }, [contextMenuHintsContext, preventDefault, mode, editor])
}

function isEditorRoot(editor: Editor, target: EventTarget | null): boolean {
  try {
    return target === ReactEditor.toDOMNode(editor, editor)
  } catch {
    return false
  }
}

/** The element holding the caret, or undefined without a selection */
function caretElement(editor: Editor): HTMLElement | undefined {
  if (!editor.selection) {
    return undefined
  }
  try {
    const [node] = ReactEditor.toDOMPoint(editor, editor.selection.focus)
    return node.nodeType === Node.TEXT_NODE ? node.parentElement ?? undefined : node as HTMLElement
  } catch {
    return undefined
  }
}

/** Just below the caret, where a menu opened from the keyboard belongs */
function caretPosition(editor: Editor): { x: number, y: number } | undefined {
  if (!editor.selection) {
    return undefined
  }
  try {
    const rect = ReactEditor.toDOMRange(editor, editor.selection).getBoundingClientRect()
    return { x: rect.left, y: rect.bottom }
  } catch {
    return undefined
  }
}

/**
 * Collapsed range at the click, or undefined to keep the current selection:
 * when the click lands inside an expanded selection, or outside any text.
 */
function getCaretRangeFromMouseEvent(editor: Editor, event: MouseEvent): Range | undefined {
  let range: Range
  try {
    range = ReactEditor.findEventRange(editor, event)
  } catch {
    return
  }

  const { selection } = editor
  if (selection && Range.isExpanded(selection) && Range.includes(selection, range.anchor)) {
    return
  }

  return range
}

function getSpellingHints(
  editor: Editor,
  topNode: SlateElement,
  element: HTMLElement,
  event: MouseEvent
): SpellingError & {
  range: Range | undefined
  apply: (replacement: string) => void
  accepted: boolean
} | undefined {
  const ancestor = element.closest('[data-spelling-error]') as HTMLElement
  const errorId = ancestor?.dataset['spellingError']

  if (!topNode.id || !errorId) {
    return
  }

  const spelling = editor.spellingLookupTable.get(topNode.id)?.errors || []
  const spellingError = spelling.find((error) => error.id === errorId)

  try {
    return (spellingError)
      ? {
        ...spellingError,
        // Read off the clicked leaf, so this describes the mark on screen.
        accepted: ancestor?.dataset['spellingAccepted'] !== undefined,
        range: getDecorationRangeFromMouseEvent(editor, event),
        apply: (replacement: string) => {
          TextbitEditor.replaceStringAtPosition(
            editor,
            spellingError.text,
            replacement
          )
        }
      }
      : undefined
  } catch (error) {
    console.warn(error)
  }
}
