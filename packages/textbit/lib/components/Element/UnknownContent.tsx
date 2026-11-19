import { useMemo } from 'react'
import { Editor, Element, Node, Transforms } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { usePluginRegistry } from '../../hooks/usePluginRegistry'
import { useTextbit } from '../../hooks/useTextbit'
import { convertUnregistered, isTextContent } from '../../utils/clipboard'
import type { ComponentProps } from '../../types'

/**
 * The inside of an unknown object: its type and its text, which cannot be
 * edited here, and at the top level, unless read-only, actions to turn it into
 * text or remove it.
 */
export function UnknownContent({ element, children }: ComponentProps) {
  const editor = useSlateStatic()
  const { readOnly, labels } = useTextbit()
  const { components } = usePluginRegistry()

  const topLevel = editor.children.includes(element)
  const texts = textsOf(element)

  // What converting gives, and so whether to offer it: text in a void, for
  // one, is dropped
  const paragraphs = useMemo(
    () => convertUnregistered([element], new Set(components.keys()), null),
    [element, components]
  )

  const replace = (convert: boolean) => {
    const at = ReactEditor.findPath(editor, element)
    Editor.withoutNormalizing(editor, () => {
      Transforms.removeNodes(editor, { at })
      if (convert && paragraphs.length) {
        Transforms.insertNodes(editor, paragraphs, { at })
      }
    })
  }

  return (
    <div contentEditable={false} className='textbit-unknown' data-tb='unknown'>
      <div data-tb='unknown-type'>{element.type}</div>
      {texts.map((text, i) => <p key={i} data-tb='unknown-text'>{text}</p>)}

      {topLevel && !readOnly && (
        <div data-tb='unknown-actions'>
          {paragraphs.length > 0 && (
            <button type='button' data-tb='unknown-action' onMouseDown={(e) => e.preventDefault()} onClick={() => replace(true)}>
              {labels.unknownToText}
            </button>
          )}
          <button type='button' data-tb='unknown-action' onMouseDown={(e) => e.preventDefault()} onClick={() => replace(false)}>
            {labels.unknownRemove}
          </button>
        </div>
      )}

      {children}
    </div>
  )
}

/** The text of each text field in an element, or of the element itself */
function textsOf(element: Element): string[] {
  const texts: string[] = []
  const walk = (current: Element) => {
    for (const child of current.children) {
      if (!Element.isElement(child)) {
        continue
      }
      if (child.class === 'text' && child.children.every(isTextContent)) {
        const text = Node.string(child)
        if (text) {
          texts.push(text)
        }
      } else {
        walk(child)
      }
    }
  }
  walk(element)

  const own = Node.string(element)
  return texts.length || !own ? texts : [own]
}
