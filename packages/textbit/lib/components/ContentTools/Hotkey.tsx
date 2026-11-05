import { Children, useContext } from 'react'
import { modifier } from '../../utils/modifier'
import { ItemContext } from './ItemContext'

export function Hotkey({ className, children }: {
  className?: string
  children?: React.ReactNode
}) {
  const { action } = useContext(ItemContext)

  return (
    // Announced through aria-keyshortcuts on the item instead of as symbols
    <div className={className} data-tb='menu-hotkey' aria-hidden='true'>
      {Children.count(children)
        ? children
        : modifier(action?.hotkey || '')
      }
    </div>
  )
}
