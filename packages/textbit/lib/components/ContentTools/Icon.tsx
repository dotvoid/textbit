import { Children, useContext } from 'react'
import { useSlateStatic } from 'slate-react'
import { ItemContext } from './ItemContext'

export function Icon({ children, className }: {
  className?: string
  children?: React.ReactNode
}) {
  const editor = useSlateStatic()
  const { isActive, action } = useContext(ItemContext)
  const Tool = Array.isArray(action?.tool) ? action.tool[0] || null : action?.tool || null

  if (Tool && !Children.count(children)) {
    return (
      <div className={className} data-tb='menu-icon' aria-hidden='true'>
        {isActive && '✓'}
        {!isActive && Tool && <Tool editor={editor} />}
      </div>
    )
  }

  return (
    <div className={className} data-tb='menu-icon' aria-hidden='true'>
      {children}
    </div>
  )
}
