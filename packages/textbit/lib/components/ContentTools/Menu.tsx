import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSelectionBounds } from '../../hooks/useSelectionBounds'
import { useFocused } from 'slate-react'
import { MenuContext } from './MenuContext'
import { useTextbit } from '../../hooks/useTextbit'

export function Menu({ children, className, style: inStyle = {} }: {
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}) {
  const [isOpen, setOpen] = useState(false)
  // Focus moves into the menu when it is used from the keyboard. The editor
  // loses focus then, but the menu must stay.
  const [hasFocus, setHasFocus] = useState(false)
  const focusRef = useRef<'first' | 'last' | undefined>(undefined)
  const triggerRef = useRef<HTMLElement | null>(null)
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const bounds = useSelectionBounds()
  const isFocused = useFocused()
  const { readOnly } = useTextbit()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !bounds || readOnly || !isFocused) {
      // Keep the last position while focus is in the menu
      return
    }

    const offsetParent = el.offsetParent as HTMLElement
    if (!offsetParent) {
      return
    }

    const containerRect = offsetParent.getBoundingClientRect()
    const selectionTop = bounds.box?.top ?? bounds.top

    // Calculate position relative to the gutter container
    const top = selectionTop - containerRect.top

    el.style.top = `${top}px`
  }, [bounds, readOnly, isFocused])

  const setIsOpen = useCallback((open: boolean, focus: 'first' | 'last' = 'first') => {
    focusRef.current = open ? focus : undefined
    setOpen(open)
  }, [])

  useEffect(() => {
    if (!isFocused && !hasFocus) {
      setOpen(false)
    }
  }, [isFocused, hasFocus])

  // When focus moves from the editor into the menu, the editor's blur
  // re-renders this before the menu's own focus event, and the menu would
  // vanish from under the moving focus. focusout already names where focus is
  // going, so claim it then, in the same update.
  useEffect(() => {
    const onFocusOut = (event: FocusEvent) => {
      if (ref.current?.contains(event.relatedTarget as Node | null)) {
        setHasFocus(true)
      }
    }
    document.addEventListener('focusout', onFocusOut, true)
    return () => document.removeEventListener('focusout', onFocusOut, true)
  }, [])

  const value = useMemo(() => ({
    isOpen,
    setIsOpen,
    focusRef,
    triggerRef,
    triggerId: `${id}-trigger`,
    contentId: `${id}-content`
  }), [isOpen, setIsOpen, id])

  // Only while the editor, or the menu itself, has focus and there is a selection
  if (readOnly || !(isFocused || hasFocus) || !bounds) {
    return null
  }

  return (
    <MenuContext.Provider value={value}>
      <div
        ref={ref}
        className={className}
        data-tb='menu'
        data-state={isOpen ? 'open' : 'closed'}
        onFocus={() => setHasFocus(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setHasFocus(false)
          }
        }}
        style={{
          position: 'absolute',
          top: 0,
          zIndex: 9909,
          ...inStyle
        }}
      >
        {children}
      </div>
    </MenuContext.Provider>
  )
}
