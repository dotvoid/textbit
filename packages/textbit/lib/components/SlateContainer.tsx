import type { PlaceholdersVisibility } from '../contexts/TextbitContext'
import type { Plugin, SpellingError } from '../types'
import type { Awareness } from '@y/protocols/awareness'

import { createEditor, Descendant, type Editor, Node } from 'slate'
import * as Y from '@y/y'
import { ReactEditor, Slate, withReact } from 'slate-react'
import { usePluginRegistry } from '../hooks/usePluginRegistry'
import { useTextbit } from '../hooks/useTextbit'
import { withTextbit } from '../editor/createTextbitEditor'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { calculateStats } from '../utils/calculateStats'
import { debounce as debounceCall } from '../utils/debounce'
import { bindField } from '../yjs/binding'
import { withSharedCursor, type TBCursorOptions } from '../yjs/cursors'
import { fieldToValue, type TBRenderer } from '../yjs/model'
import { SUGGESTIONS_MAP } from '../suggestions/store'
import { TEXT_TYPE } from '../utils/textType'
import { AgentPresenceProvider } from '../contexts/AgentPresenceProvider'
import { AgentChangesProvider } from '../contexts/AgentChangesProvider'
import { SuggestionsProvider } from '../contexts/SuggestionsProvider'
import { CommentsProvider } from '../contexts/CommentsProvider'
import type { Comments } from '../comments/types'
import { SharedAwarenessContext } from '../contexts/SharedAwarenessContext'

interface SlateContainerBaseProps {
  children: React.ReactNode
  verbose?: boolean
  readOnly?: boolean
  debounce?: number
  spellcheckDebounce?: number
  placeholders?: PlaceholdersVisibility
  plugins?: Plugin[]
  className?: string
  style?: React.CSSProperties
  onSpellcheck?: (texts: { lang: string, text: string }[]) => Promise<Omit<SpellingError, 'id'>[][]>
  comments?: Comments
}

interface SlateContainerStringProps extends SlateContainerBaseProps {
  value: string
  onChange?: (value: string) => void
}
interface SlateContainerDefaultProps extends SlateContainerBaseProps {
  value: Descendant[]
  onChange?: (value: Descendant[]) => void
}
interface SlateContainerYjsProps extends SlateContainerBaseProps {
  value: Y.Node
  renderer?: TBRenderer
  onChange?: (value: Descendant[]) => void
}
interface SlateContainerCollaborationProps extends SlateContainerYjsProps {
  awareness: Awareness
  cursor?: TBCursorOptions
}
type SlateContainerProps = SlateContainerStringProps | SlateContainerDefaultProps | SlateContainerYjsProps | SlateContainerCollaborationProps

export function SlateContainer(props: SlateContainerStringProps): React.ReactElement
export function SlateContainer(props: SlateContainerDefaultProps): React.ReactElement
export function SlateContainer(props: SlateContainerYjsProps): React.ReactElement
export function SlateContainer(props: SlateContainerCollaborationProps): React.ReactElement
export function SlateContainer(props: SlateContainerProps) {
  const { children, value, readOnly } = props
  const { debounce, spellcheckDebounce, dispatch, lang } = useTextbit()
  const { plugins, components } = usePluginRegistry()

  // Preserve editor across HMR
  const editorRef = useRef<Editor | null>(null)

  // The origin of this editor's changes to a shared field, stable for its life
  const origin = useRef<object>({ textbit: 'editor' })

  const shared = isSlateContainerYjsProps(props) ? props : undefined
  const collaboration = isSlateContainerCollaborationProps(props) ? props : undefined

  if (!editorRef.current) {
    editorRef.current = withTextbit(withReact(createEditor()), {
      plugins,
      components,
      lang,
      shared: shared?.value,
      bind: false,
      onSpellcheck: readOnly ? undefined : props.onSpellcheck,
      spellcheckDebounce
    })
  }

  const editor = editorRef.current

  // Bound while mounted: under StrictMode an effect runs, cleans up and runs
  // again, and each run binds afresh. A layout effect, so the editor is bound
  // before any child's effect looks at it.
  const field = shared?.value
  const renderer = shared?.renderer
  const awareness = collaboration?.awareness
  const cursor = collaboration?.cursor
  useLayoutEffect(() => {
    if (!field) {
      return
    }
    const doc = field.doc
    const binding = bindField(editor, field, {
      origin: origin.current,
      renderer,
      undoScope: doc ? [doc.get(SUGGESTIONS_MAP)] : []
    })
    const stopCursor = awareness
      ? withSharedCursor(editor, awareness, cursor, () => ReactEditor.isFocused(editor))
      : undefined
    editor.onChange()
    return () => {
      stopCursor?.()
      binding.release()
    }
  }, [editor, field, renderer, awareness, cursor])

  const sharedAwareness = useMemo(() => ({ awareness: awareness ?? null, cursor }), [awareness, cursor])

  // Initialize the editor with the provided value.
  const initialValue = useMemo(() => {
    if (value instanceof Y.Node) {
      return fieldToValue(value, renderer)
    } else if (typeof value === 'string') {
      return stringToDescentant(value)
    } else {
      return value
    }
  }, [value, renderer])

  // Debounced onChange callback
  const handleChange = useCallback((newValue: Descendant[]) => {
    if (props.onChange) {
      if (isSlateContainerDefaultProps(props) || isSlateContainerYjsProps(props)) {
        props.onChange(newValue)
      } else if (isSlateContainerStringProps(props)) {
        props.onChange(newValue
          .map(node => Node.string(node))
          .join('\n'))
      }
    }

    dispatch({ stats: calculateStats(editor) })

    // Specifically only depend on onChange, value and dispatch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onChange, props.value, dispatch])

  // Debounced onChange callback
  const onChangeCallback = useMemo(
    () => readOnly ? undefined : debounceCall(handleChange, debounce || 1250),
    [handleChange, readOnly, debounce]
  )

  // A change still waiting when the editor unmounts, or when the callback is
  // replaced, is delivered then, not after the editor is gone
  useEffect(() => () => onChangeCallback?.flush(), [onChangeCallback])

  // Initialize spellcheck and stats
  useEffect(() => {
    editor.spellcheck?.force()
    dispatch({ stats: calculateStats(editor) })

    return () => {
      // Cancel any pending spellcheck debounce timeouts
      editor.spellcheck?.cancel()
    }
  }, [editor, dispatch])

  return (
    <Slate editor={editor} initialValue={initialValue} onChange={onChangeCallback ?? noop}>
      <SharedAwarenessContext.Provider value={sharedAwareness}>
        <AgentPresenceProvider>
          <AgentChangesProvider>
            <SuggestionsProvider>
              <CommentsProvider store={props.comments}>
                {children}
              </CommentsProvider>
            </SuggestionsProvider>
          </AgentChangesProvider>
        </AgentPresenceProvider>
      </SharedAwarenessContext.Provider>
    </Slate>
  )
}

function stringToDescentant(value: string): Descendant[] {
  return value.split('\n').map((text) => {
    return {
      id: crypto.randomUUID(),
      type: TEXT_TYPE,
      class: 'text',
      children: [{ text }]
    }
  })
}

function isSlateContainerYjsProps(
  props: SlateContainerProps
): props is SlateContainerYjsProps {
  return props.value instanceof Y.Node
}

function isSlateContainerCollaborationProps(
  props: SlateContainerProps
): props is SlateContainerCollaborationProps {
  return props.value instanceof Y.Node && 'awareness' in props && props.awareness != null
}

function isSlateContainerStringProps(
  props: SlateContainerProps
): props is SlateContainerStringProps {
  return typeof props.value === 'string'
}

function isSlateContainerDefaultProps(
  props: SlateContainerProps
): props is SlateContainerDefaultProps {
  return !isSlateContainerYjsProps(props) && !isSlateContainerStringProps(props)
}

function noop() {}
