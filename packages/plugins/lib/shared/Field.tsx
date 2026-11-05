import { Editor, Transforms, type Element } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { ChildPlaceholder } from './ChildPlaceholder'

/**
 * The inside of a labelled text field in a block, such as an image's caption.
 * The field is a text element, so the caret moves in and out of it like any
 * other text. The label is not editable; a click on it puts the caret in the
 * field, like a <label>. Style with .tb-field-label and .tb-field-text.
 */
export function FieldContent({ element, label, hint, children }: {
  element: Element
  label: string
  hint?: string
  children: React.ReactNode
}) {
  const editor = useSlateStatic()

  return (
    <>
      <span
        contentEditable={false}
        className='tb-field-label'
        style={{ userSelect: 'none' }}
        onMouseDown={(event) => {
          event.preventDefault()
          Transforms.select(editor, Editor.end(editor, ReactEditor.findPath(editor, element)))
          ReactEditor.focus(editor)
        }}
      >
        {label}
      </span>
      <span className='tb-field-text' style={{ position: 'relative' }}>
        <ChildPlaceholder element={element}>{hint}</ChildPlaceholder>
        {children}
      </span>
    </>
  )
}
