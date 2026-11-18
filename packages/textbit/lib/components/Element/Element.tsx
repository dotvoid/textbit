import { Node, Path, type Element } from 'slate'
import { type RenderElementProps, ReactEditor, useSlateStatic } from 'slate-react'
import { ChildElement } from './ChildElement'
import { ParentElement } from './ParentElement'
import { InlineElement } from './InlineElement'
import { UnknownElement } from './UnknownElement'
import { UnknownContent } from './UnknownContent'
import type { ChildComponentEntry } from '../../types'
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
  const component = components.get(element.type)

  // Get the path for this element
  const path = ReactEditor.findPath(editor, element)

  if (!component) {
    // A top-level object whose plugin is missing is still an object: the same
    // block caret, selection and drag as any other
    return path.length === 1 && element.class !== 'inline'
      ? <ParentElement {...props} entry={UNKNOWN_ENTRY} />
      : <UnknownElement {...props} />
  }

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

/** How ParentElement renders a top-level element whose plugin is missing */
const UNKNOWN_ENTRY: ChildComponentEntry = {
  class: 'block',
  component: UnknownContent
}
