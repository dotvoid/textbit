import { Children, useContext } from 'react'
import { ContextMenuHintsContext } from './ContextMenuHintsContext'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { Editor } from 'slate'

export function Item({
  children,
  className,
  func = undefined
}: {
  children: React.ReactNode
  className?: string
  func?: (editor: Editor) => void
}) {
  const editor = useSlateStatic()
  const menuCtx = useContext(ContextMenuHintsContext)

  if (!Children.count(children)) {
    return <></>
  }

  const activate = (item: HTMLElement) => {
    const menu = item.closest('[role="menu"]')
    if (func) {
      func(editor)
    }

    // Back to the editor, unless the item moved focus somewhere on purpose
    const active = document.activeElement
    if (!active || active === document.body || menu?.contains(active)) {
      ReactEditor.focus(editor)
    }

    menuCtx?.dispatch({
      menu: undefined,
      spelling: undefined
    })
  }

  return (
    <a
      role='menuitem'
      tabIndex={-1}
      className={className}
      onMouseDown={(e) => {
        e.preventDefault()
        activate(e.currentTarget)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          activate(e.currentTarget)
        }
      }}
    >
      {children}
    </a>
  )
}
