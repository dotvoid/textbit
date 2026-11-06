import { useRef, useContext, useCallback } from 'react'
import { type Element as SlateElement } from 'slate'
import { useSlateStatic } from 'slate-react'

import { DragstateContext } from '../../contexts/DragStateContext'
import { useTextbit } from '../../hooks/useTextbit'
import { hasDraggableDOMTarget } from '../../utils/hasDraggableTarget'
import { hasDraggableElementTarget } from '../../utils/hasDraggableElement'

export function Droppable({ children, element }: {
  children: React.ReactNode
  element?: SlateElement
}) {
  const { readOnly } = useTextbit()
  const editor = useSlateStatic()
  const ctx = useContext(DragstateContext)
  const ref = useRef<HTMLDivElement>(null)

  /**
   * Drag start handler. When the event target node path includes an element
   * with the class "text" dragging should be prevented to allow the user
   * selecting text without accidentally dragging the ancestor block element.
   * If a DOM element ancestor has draggable="true" set it will still allow
   * dragging of the element even when it is class "text".
   */
  const onDragStartCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly || !element?.id) {
      return
    }

    // Check if we need to prevent dragging
    if (!hasDraggableDOMTarget(event) && !hasDraggableElementTarget(editor, event)) {
      event.stopPropagation()
      event.preventDefault()
      return
    }

    event.stopPropagation()
    if (ref?.current) {
      createDragImage(ref.current, event, element.id)
    }
  }, [readOnly, element?.id, editor])

  const onDragEnd = useCallback(() => {
    if (readOnly) {
      return
    }

    ctx?.onDragLeave()

    if (ref?.current) {
      ref.current.style.opacity = '1'
      cleanup()
    }
  }, [readOnly, ctx])

  return (
    <div
      data-id={element?.id || ''}
      ref={ref}
      draggable={['block', 'void'].includes(element?.class || '') ? 'true' : 'false'}
      onDragStartCapture={onDragStartCapture}
      onDragEnd={onDragEnd}
    >
      {children}
    </div>
  )
}


/*
 * Remove temporarily created drag images
 */
function cleanup() {
  const temps = document.getElementsByClassName('textbit-dragged-temp')
  if (temps.length) {
    for (const t of temps) {
      if (t.parentNode) {
        t.parentNode.removeChild(t)
      }
    }
  }
}


/**
 * Create a dragImage by cloning the dragged element
 */
function createDragImage(el: HTMLDivElement, e: React.DragEvent<HTMLDivElement>, dataId: string) {
  const clone = el.cloneNode(true) as HTMLDivElement
  const { left, top } = el.getBoundingClientRect()

  const clonedChild = clone.firstChild as HTMLDivElement
  clonedChild.style.transform = 'scale(0.6) rotate(2deg)'
  clone.style.width = `${el.offsetWidth}px`
  clone.style.height = `${el.offsetHeight}px`
  clone.style.position = 'absolute'
  clone.style.top = '-9999px'
  clone.classList.add('textbit-dragged-temp') // Used to clean out in dragEnd()

  document.body.appendChild(clone)

  el.style.opacity = '0.5'
  e.dataTransfer.clearData()
  e.dataTransfer.setData('textbit/droppable-id', dataId)
  e.dataTransfer.setDragImage(
    clone,
    (e.clientX - left),
    (e.clientY - top)
  )
}
