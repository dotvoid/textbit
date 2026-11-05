import { useEffect } from 'react'
import { Editor, Node, Path, type Element } from 'slate'
import { type RenderElementProps, ReactEditor, useSlateStatic } from 'slate-react'
import { ChildElement } from './ChildElement'
import { ParentElement } from './ParentElement'
import { InlineElement } from './InlineElement'
import { UnknownElement } from './UnknownElement'
import { usePluginRegistry } from '../../hooks/usePluginRegistry'


/**
 * Render a custom Slate element
 */
export function ElementComponent(props: RenderElementProps & {
  selectedBlockPath?: Path
}) {
  const editor = useSlateStatic()
  const { element } = props
  const { components } = usePluginRegistry()
  useVoidSpacerCheck(editor, element)
  const component = components.get(element.type)
  if (!component) {
    return <UnknownElement {...props} />
  }

  // Get the path for this element
  const path = ReactEditor.findPath(editor, element)

  // No parents found in path, render a root element
  if (path.length === 1) {
    return (
      <ParentElement
        {...props}
        entry={component.componentEntry}
        options={component.pluginOptions}
      />
    )
  }

  // Render an inline child element
  if (component.class === 'inline') {
    return (
      <InlineElement
        {...props}
        entry={component.componentEntry}
        options={component.pluginOptions}
      />
    )
  }

  // Render a child element and pass it the rootNode for reference
  const rootNode = Node.get(editor, [path[0]]) as Element
  return (
    <ChildElement
      {...props}
      entry={component.componentEntry}
      rootNode={rootNode}
      options={component.pluginOptions}
    />
  )
}

const warnedVoidTypes = new Set<string>()

/**
 * A void element has to render its children: the hidden spacer Slate puts the
 * caret on. A component that drops them leaves no caret when the element is
 * selected, so arrow keys and typing act wherever the browser's caret last was.
 * Easy to miss and hard to trace, so say so, once per element type.
 */
function useVoidSpacerCheck(editor: Editor, element: Element) {
  useEffect(() => {
    if (!Editor.isVoid(editor, element) || warnedVoidTypes.has(element.type)) {
      return
    }

    let node: HTMLElement
    try {
      node = ReactEditor.toDOMNode(editor, element)
    } catch {
      return
    }

    if (!node.querySelector('[data-slate-spacer]')) {
      warnedVoidTypes.add(element.type)
      console.warn(
        `textbit: the void element "${element.type}" does not render its children. ` +
        'Render {children} after its content, or the caret is lost when it is selected.'
      )
    }
  }, [editor, element])
}
