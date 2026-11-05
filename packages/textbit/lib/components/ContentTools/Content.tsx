import { useContext, useEffect, useLayoutEffect, useRef } from 'react'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { MenuContext } from './MenuContext'
import { useKeydownGlobal } from '../../hooks/useKeydownGlobal'
import { GutterContext } from '../GutterProvider/GutterContext'
import { focusItem, handleRovingKeys, MENU_ITEM } from '../../utils/menuKeyboard'

export function Content({ children, className }: {
  className?: string
  children?: React.ReactNode
}) {
  const { isOpen, setIsOpen } = useContext(MenuContext)
  const keyTriggerRef = useKeydownGlobal<HTMLDivElement>((e) => {
    if (isOpen && (e.key === 'Escape' || e.key === 'Tab')) {
      e.preventDefault()
      setIsOpen(false)
    }
  })

  return (
    <div ref={keyTriggerRef}>
      {isOpen && (
        <Popover className={className}>
          {children}
        </Popover>
      )}
    </div>
  )
}

function Popover({ children, className }: {
  className?: string
  children?: React.ReactNode
}) {
  const editor = useSlateStatic()
  const { triggerRef } = useContext(GutterContext)
  const { setIsOpen, focusRef, contentId, triggerId, triggerRef: menuTriggerRef } = useContext(MenuContext)
  const ref = useRef<HTMLDivElement>(null)

  // Opening the menu moves focus to its first item, or the last on ArrowUp
  useEffect(() => {
    focusItem(ref.current, MENU_ITEM, focusRef.current ?? 'first')
  }, [focusRef])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (handleRovingKeys(event, ref.current, MENU_ITEM, 'vertical')) {
      return
    }
    if (event.key === 'Escape') {
      // Back to the button that opened it
      event.preventDefault()
      event.stopPropagation()
      setIsOpen(false)
      menuTriggerRef.current?.focus()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      setIsOpen(false)
      ReactEditor.focus(editor)
    }
  }

  useLayoutEffect(() => {
    const el = ref.current
    const trigger = triggerRef?.current

    if (!trigger || !el) {
      return
    }

    // Get the bounding box of the trigger element
    const triggerBox = trigger.getBoundingClientRect()
    const popoverRect = el.getBoundingClientRect()
    const gap = 8

    // Position to the right of the trigger button
    let left = triggerBox.right + gap
    let top = triggerBox.top

    // Constrain to viewport
    const maxLeft = window.innerWidth - popoverRect.width - gap
    left = Math.min(left, maxLeft)

    // Flip down if not enough space
    if (top + popoverRect.height > window.innerHeight - gap) {
      top = Math.max(gap, window.innerHeight - popoverRect.height - gap)
    }

    el.style.transform = `translate(${left}px, ${top}px)`
  }, [triggerRef])

  return (
    <div
      ref={ref}
      id={contentId}
      role='menu'
      aria-labelledby={triggerId}
      className={className}
      data-tb='menu-content'
      onKeyDown={onKeyDown}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        willChange: 'transform'
      }}
    >
      {children}
    </div>
  )
}
