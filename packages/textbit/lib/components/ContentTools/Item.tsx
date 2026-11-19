import { type PropsWithChildren, useContext } from 'react'
import { ReactEditor, useSlateSelection, useSlateStatic } from 'slate-react'
import { consumeFilesFor } from '../../utils/consumeFiles'
import { actionVisibility } from '../../utils/actionVisibility'
import { usePluginRegistry } from '../../hooks/usePluginRegistry'
import { ItemContext } from './ItemContext'
import { MenuContext } from './MenuContext'
import { ariaKeyShortcuts } from '../../utils/menuKeyboard'

export function Item({ children, className, action: actionName }: PropsWithChildren & {
  className?: string
  action: string
}) {
  const { actions } = usePluginRegistry()
  const editor = useSlateStatic()
  const selection = useSlateSelection()
  const { setIsOpen } = useContext(MenuContext)
  const action = actions.find((a) => a.name === actionName)

  if (!action) {
    return <></>
  }

  const [isVisible, isEnabled, isActive] = actionVisibility(editor, selection, action)

  if (!isVisible) {
    return <></>
  }

  return (
    <ItemContext.Provider value={{ isActive: isActive ? true : false, action }}>
      <a
        role='menuitem'
        tabIndex={-1}
        aria-keyshortcuts={ariaKeyShortcuts(action.hotkey)}
        aria-disabled={isEnabled ? undefined : true}
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
    if (!action || !isEnabled) {
      return
    }

    const menu = item.closest('[role="menu"]')
    action.handler({
      editor,
      type: action.plugin.name,
      options: action.plugin.options,
      consumeFiles: consumeFilesFor(editor)
    })

    // Back to the editor, unless the action moved focus somewhere on purpose
    const active = document.activeElement
    if (!active || active === document.body || menu?.contains(active)) {
      ReactEditor.focus(editor)
    }
    setIsOpen(false)
  }
}

