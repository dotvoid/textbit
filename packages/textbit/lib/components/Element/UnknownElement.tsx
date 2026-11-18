import { useSlateStatic, type RenderElementProps } from 'slate-react'
import { Droppable } from './Droppable'
import { UnknownContent } from './UnknownContent'

/**
 * Used when no renderer exists: an element whose plugin is not registered.
 * Its data is kept as it is. A top-level one renders as an object like any
 * other, through ParentElement with UnknownContent, so it gets the same block
 * caret, selection and drag; this renders unknown elements inside others.
 */
export function UnknownElement(props: RenderElementProps) {
  const { element, attributes, children } = props
  const editor = useSlateStatic()

  if (element.class === 'inline') {
    return (
      <Droppable>
        <div
          contentEditable={false}
          className='textbit-parent textbit-unknown'
          data-id={element.id}
          data-type={element.type}
          {...attributes}
        >
          <pre style={{ fontSize: '80%' }}>
            {' '}
            UNKNOWN OBJECT(
            {element.type}
            )
          </pre>
          <div style={{ opacity: '0.4' }}>
            {children}
          </div>
        </div>
      </Droppable>
    )
  }

  return (
    <div data-id={element.id} data-type={element.type} {...attributes}>
      <UnknownContent element={element} editor={editor}>{children}</UnknownContent>
    </div>
  )
}
