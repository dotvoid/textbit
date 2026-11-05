import React, { type PropsWithChildren, useContext } from 'react'
import { ReactEditor, useSlateSelection, useSlateStatic } from 'slate-react'
import { type BaseSelection, Editor, Element } from 'slate'
import { pipeFromFileInput } from '../../utils/pipes'
import { TextbitElement } from '../../utils/textbit-element'
import type { PluginRegistryAction } from '../../contexts/PluginRegistry/lib/types'
import { usePluginRegistry } from '../../hooks/usePluginRegistry'
import { ItemContext } from './ItemContext'
import { MenuContext } from './MenuContext'
import { ariaKeyShortcuts } from '../../utils/menuKeyboard'

export function Item({ children, className, action: actionName }: PropsWithChildren & {
  className?: string
  action: string
}) {
  const { plugins, actions } = usePluginRegistry()
  const editor = useSlateStatic()
  const selection = useSlateSelection()
  const { setIsOpen } = useContext(MenuContext)
  const action = actions.find((a) => a.name === actionName)

  if (!action) {
    return <></>
  }

  const [isVisible, , isActive] = visibilityBySelection(editor, selection, action) || [false, false, false]

  if (!isVisible) {
    return <></>
  }

  return (
    <ItemContext.Provider value={{ isActive: isActive ? true : false, action }}>
      <a
        role='menuitem'
        tabIndex={-1}
        aria-keyshortcuts={ariaKeyShortcuts(action.hotkey)}
        className={className}
        data-tb='menu-item'
        data-state={isActive ? 'active' : 'inactive'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            activate(e.currentTarget)
          }
        }}
        onMouseDown={(e) => {
          e.preventDefault()
          activate(e.currentTarget)
        }}
      >
        {children}
      </a>
    </ItemContext.Provider>
  )

  function activate(item: HTMLElement) {
    if (!action) {
      return
    }

    const menu = item.closest('[role="menu"]')
    action.handler({
      editor,
      type: action.plugin.name,
      options: action.plugin.options,
      api: {
        // FIXME: This is just to expose some functionality, but it is not a good way to give access to an api...
        consumeFileInputChangeEvent: (
          editor: Editor,
          e: React.ChangeEvent<HTMLInputElement>
        ) => {
          pipeFromFileInput(editor, plugins, e)
        }
      }
    })

    // Back to the editor, unless the action moved focus somewhere on purpose
    const active = document.activeElement
    if (!active || active === document.body || menu?.contains(active)) {
      ReactEditor.focus(editor)
    }
    setIsOpen(false)
  }
}


function visibilityBySelection(editor: Editor, selection: BaseSelection, action: PluginRegistryAction): [boolean, boolean, boolean] {
  if (!selection) {
    return [false, false, false]
  }

  const matches = Array.from(
    Editor.nodes(editor, {
      at: Editor.unhangRange(editor, selection),
      match: (el) => {
        return !Editor.isEditor(el) && Element.isElement(el)
      }
    })
  )

  if (!matches.length) {
    return [false, false, false]
  }

  if (!action?.visibility) {
    return [false, false, false]
  }

  const outerElement = matches[0][0]
  const innerElement = matches[matches.length - 1][0]

  if (!TextbitElement.isElement(outerElement)) {
    return [false, false, false]
  }

  // Pass the innermost element (cursor position) as second arg so visibility
  // functions can make context-aware decisions when inside nested blocks.
  const cursorElement = TextbitElement.isElement(innerElement) ? innerElement : undefined
  const status = action?.visibility(outerElement, cursorElement)
  return status || [[false, false, false]]
}
