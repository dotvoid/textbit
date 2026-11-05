import { Children } from 'react'
import { useSlateSelection, useSlateSelector, useSlateStatic } from 'slate-react'
import type { PluginRegistryAction } from '../../contexts/PluginRegistry/lib/types'
import { Editor } from 'slate'
import { TextbitElement } from '../../utils/textbit-element'
import { hasMark } from '../../utils/hasMark'
import { toggleLeaf } from '../../utils/toggleLeaf'
import { ariaKeyShortcuts } from '../../utils/menuKeyboard'

//
// FIXME: This does not update selection on click (i.e links)
// FIXME: Implement disabled
//
export function Item({ action, className, children }: {
  action: PluginRegistryAction
  className?: string
  children?: React.ReactNode
}) {
  const editor = useSlateStatic()
  const selection = useSlateSelection()

  // Follows the marks, not only the selection: toggling bold leaves the
  // selection as it was, and the button must still show it as on
  const isActive = useSlateSelector((e) => hasMark(e, action.plugin.name))
  const leafEntry = Editor.nodes(editor, {
    mode: 'lowest'
  }).next().value || undefined

  const inlineNodes = Array.from(Editor.nodes(editor, {
    match: (n) => TextbitElement.isElement(n) && n.class === 'inline' && n.type === action.plugin.name,
    at: selection ?? undefined
  }))

  // Multiple inline nodes can't be handled simultaneously, marked as disabled
  const Tool = (!Array.isArray(action.tool))
    ? action.tool
    : (action.tool.length === 2 && inlineNodes.length === 1)
      ? action.tool[1]
      : action.tool[0]

  if (!Tool) {
    return
  }

  if (inlineNodes.length === 1) {
    const inlineNode = inlineNodes[0]
    return (
      <div data-state='active'>
        {!Children.count(children)
          ? <Tool editor={editor} active={isActive} entry={inlineNode} />
          : <Tool editor={editor} active={isActive} entry={inlineNode}>{children}</Tool>
        }
        <em className='active'></em>
      </div>
    )
  }

  const activate = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
    if (inlineNodes.length > 1) {
      return
    }

    const defaultAccepted = action.handler({
      editor,
      event,
      type: action.plugin.name,
      options: {
        ...action.plugin.options
      }
    })

    if (defaultAccepted) {
      toggleLeaf(editor, action.plugin.name)
    }

    if (!event.defaultPrevented) {
      event.preventDefault()
    }
  }

  return (
    <div
      role='button'
      tabIndex={-1}
      aria-label={action.title ?? humanize(action.name)}
      // Formatting is on or off; other tools, like a link, are not toggles
      aria-pressed={action.plugin.class === 'leaf' ? isActive : undefined}
      aria-disabled={inlineNodes.length > 1 ? true : undefined}
      aria-keyshortcuts={ariaKeyShortcuts(action.hotkey)}
      data-state={isActive ? 'active' : 'inactive'}
      className={className || ''}
      data-tb='toolbar-item'
      onMouseDown={activate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          activate(event)
        }
      }}
    >
      <Tool editor={editor} active={isActive} entry={leafEntry}>
        {children}
      </Tool>
    </div>
  )
}

/** `core/bold/toggle-bold` -> `Toggle bold`, for actions without a title */
function humanize(name: string): string {
  const text = (name.split('/').pop() ?? name).replace(/[-_]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}
