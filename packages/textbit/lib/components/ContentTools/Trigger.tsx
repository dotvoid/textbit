import { type PropsWithChildren, useContext, useEffect } from 'react'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { useClickGlobal } from '../../hooks/useClickGlobal'
import { MenuContext } from './MenuContext'
import { GutterContext } from '../GutterProvider/GutterContext'
import { registerToolbarFocus } from '../core/FocusToolbar'

export function Trigger({ children, className }: PropsWithChildren & {
  className?: string
  children?: React.ReactNode
}) {
  const editor = useSlateStatic()
  const { isOpen, setIsOpen, triggerId, contentId, triggerRef: menuTriggerRef } = useContext(MenuContext)
  const { triggerRef, updateTriggerRef } = useContext(GutterContext)
  const mouseTriggerRef = useClickGlobal<HTMLAnchorElement>(() => {
    setIsOpen(false)
  })

  // Sync the local ref to the context ref
  useEffect(() => {
    if (triggerRef && mouseTriggerRef.current) {
      updateTriggerRef(mouseTriggerRef.current)
    }
    menuTriggerRef.current = mouseTriggerRef.current
  }, [triggerRef, updateTriggerRef, mouseTriggerRef, menuTriggerRef])

  useEffect(() => registerToolbarFocus(editor, 'gutter', () => {
    const trigger = mouseTriggerRef.current
    trigger?.focus()
    return !!trigger && document.activeElement === trigger
  }), [editor, mouseTriggerRef])

  const onKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true, 'first')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIsOpen(true, 'last')
    } else if (e.key === 'Escape' && !isOpen) {
      e.preventDefault()
      ReactEditor.focus(editor)
    }
  }

  return (
    <a
      ref={mouseTriggerRef}
      id={triggerId}
      role='button'
      tabIndex={0}
      aria-haspopup='menu'
      aria-expanded={isOpen}
      aria-controls={isOpen ? contentId : undefined}
      className={className}
      onMouseDown={(e) => {
        e.preventDefault()
        setIsOpen(!isOpen)
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </a>
  )
}
