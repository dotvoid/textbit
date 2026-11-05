import { useCallback, useContext, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { useContextMenuHints } from './useContextMenuHints'
import { ContextMenuHintsContext } from './ContextMenuHintsContext'
import { useTextbit } from '../../hooks/useTextbit'
import { focusItem, handleRovingKeys, MENU_ITEM } from '../../utils/menuKeyboard'

export function Menu({ children, className, 'aria-label': ariaLabel }: {
  className?: string
  children?: React.ReactNode
  'aria-label'?: string
}) {
  return createPortal(
    <Popover className={className} ariaLabel={ariaLabel}>
      {children}
    </Popover>,
    document.body
  )
}

function Popover({ children, className, ariaLabel }: {
  className?: string
  children?: React.ReactNode
  ariaLabel?: string
}) {
  const editor = useSlateStatic()
  const { readOnly } = useTextbit()
  const contextMenuContext = useContext(ContextMenuHintsContext)
  const ref = useRef<HTMLDivElement>(null)
  const { menu } = useContextMenuHints()

  const close = useCallback((refocusEditor: boolean) => {
    contextMenuContext?.dispatch({
      menu: undefined,
      spelling: undefined
    })
    if (refocusEditor) {
      ReactEditor.focus(editor)
    }
  }, [contextMenuContext, editor])

  const updatePosition = useCallback(() => {
    const el = ref.current
    if (!el || !menu?.position) {
      return
    }

    const rect = el.getBoundingClientRect()
    const { x, y } = menu.position
    const gap = 8

    let left = x
    let top = y + gap // Position below by default

    // Horizontal bounds
    const maxLeft = window.innerWidth - rect.width - gap
    left = Math.max(gap, Math.min(left, maxLeft))

    // Vertical bounds - flip to below if not enough space above
    if (top + rect.height > window.innerHeight - gap) {
      top = y - rect.height - gap
    }

    el.style.transform = `translate(${left}px, ${top}px)`
  }, [menu?.position])

  // Close menu on outside interaction. Keys inside the menu are its own.
  useEffect(() => {
    if (!menu?.position || readOnly) return

    const handleOutsideInteraction = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) {
        return
      }
      close(false)
    }

    // Use one handler for both events
    window.addEventListener('pointerdown', handleOutsideInteraction, { capture: true })
    window.addEventListener('keydown', handleOutsideInteraction, { capture: true })

    return () => {
      window.removeEventListener('pointerdown', handleOutsideInteraction, { capture: true })
      window.removeEventListener('keydown', handleOutsideInteraction, { capture: true })
    }
  }, [readOnly, menu?.position, close])

  // Position the menu when it appears, then move focus into it so it can be
  // used from the keyboard
  useEffect(() => {
    if (!readOnly && menu?.position) {
      requestAnimationFrame(() => {
        updatePosition()
        focusItem(ref.current, MENU_ITEM, 'first')
      })
    }
  }, [readOnly, menu?.position, updatePosition])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (handleRovingKeys(event, ref.current, MENU_ITEM, 'vertical')) {
      return
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      close(true)
    }
  }

  if (!menu?.position || readOnly) {
    return null
  }

  return (
    <div
      ref={ref}
      role='menu'
      aria-label={ariaLabel}
      className={className}
      data-tb='context-menu'
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        willChange: 'transform',
        pointerEvents: 'auto',
        zIndex: 9702
      }}
    >
      {children}
    </div>
  )
}
