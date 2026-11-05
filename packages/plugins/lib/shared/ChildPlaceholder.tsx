import { Node, type Element } from 'slate'

/**
 * Hint text over an empty nested text element: a code block body, a caption, a
 * list item. Textbit's own placeholders only cover top-level text. Positioned
 * over the element and ignored by pointer and screen reader; style the text
 * with .tb-child-placeholder.
 */
export function ChildPlaceholder({ element, children }: {
  element: Element
  children?: React.ReactNode
}) {
  if (!children || Node.string(element).length > 0) {
    return null
  }

  return (
    <span
      contentEditable={false}
      aria-hidden='true'
      className='tb-child-placeholder'
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', userSelect: 'none' }}
    >
      {children}
    </span>
  )
}
