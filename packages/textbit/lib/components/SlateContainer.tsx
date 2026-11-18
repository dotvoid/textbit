import type { PlaceholdersVisibility } from '../contexts/TextbitContext'
import type { PluginDefinition, SpellingError } from '../types'
import type { Awareness } from 'y-protocols/awareness'

import { createEditor, Descendant, type Editor, Node } from 'slate'
import * as Y from 'yjs'
import { Slate, withReact } from 'slate-react'
import { usePluginRegistry } from '../hooks/usePluginRegistry'
import { useTextbit } from '../hooks/useTextbit'
import { withTextbit } from '../editor/createTextbitEditor'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { calculateStats } from '../utils/calculateStats'
import { debounce as debounceCall } from '../utils/debounce'
import { YjsEditor } from '@slate-yjs/core'
import { TEXT_TYPE } from '../utils/textType'

interface SlateContainerBaseProps {
  children: React.ReactNode
  verbose?: boolean
  readOnly?: boolean
  debounce?: number
  spellcheckDebounce?: number
  placeholders?: PlaceholdersVisibility
  plugins?: PluginDefinition[]
  className?: string
  style?: React.CSSProperties
  onSpellcheck?: (texts: { lang: string, text: string }[]) => Promise<Omit<SpellingError, 'id'>[][]>
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
  value: Y.XmlText
  onChange?: (value: Descendant[]) => void
}
interface SlateContainerCollaborationProps extends SlateContainerYjsProps {
  awareness: Awareness
  cursor?: {
    stateField?: string
    dataField?: string
    autoSend?: boolean
    data: Record<string, unknown>
  }
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

  // Create stable localOrigin symbol per component instance
  const localOrigin = useRef<symbol>(Symbol('textbit-editor'))

  if (!editorRef.current) {
    const collaboration = isSlateContainerCollaborationProps(props) ? props : undefined
    const editor = withTextbit(withReact(createEditor()), {
      plugins,
      components,
      lang,
      shared: isSlateContainerYjsProps(props) ? props.value : undefined,
      localOrigin: localOrigin.current,
      awareness: collaboration?.awareness,
      cursor: collaboration?.cursor,
      onSpellcheck: readOnly ? undefined : props.onSpellcheck,
      spellcheckDebounce
    })

    editorRef.current = editor
  }

  const editor = editorRef.current

  useEffect(() => {
    if (YjsEditor.isYjsEditor(editor)) {
      YjsEditor.connect(editor)

      return () => {
        YjsEditor.disconnect(editor)
      }
    }
  }, [editor])

  // Initialize the editor with the provided value.
  const initialValue = useMemo(() => {
    if (value instanceof Y.XmlText) {
      return [] // Empty initial value for yjs editor
    } else if (typeof value === 'string') {
      return stringToDescentant(value)
    } else {
      return value
    }
  }, [value])

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
      {children}
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
  return props.value instanceof Y.XmlText
}

function isSlateContainerCollaborationProps(
  props: SlateContainerProps
): props is SlateContainerCollaborationProps {
  return props.value instanceof Y.XmlText && 'awareness' in props && props.awareness != null
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
