import { getDecorationRangeFromMouseEvent, getNodeEntryFromDomNode } from '../utils/utils'
import { MouseEventHandler, useContext, useMemo } from 'react'
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
      const targetElement = (event.target as Node).nodeType === Node.TEXT_NODE
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
      const range = spelling
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
          position: {
            x: event.clientX,
            y: event.clientY
          },
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
