import React, { useContext, useRef, useLayoutEffect, useState } from 'react'
import { DragstateContext } from '../contexts/DragStateContext'

const HEIGHT = 3

/**
 * Shows where a dragged block or dropped file would go: a line between blocks,
 * while something is dragged over the editor. Place it in `Textbit.Editable`;
 * style it with `className` and `style`; `data-dragover` is set while it shows.
 */
export function DropMarker({ className, style = {} }: {
  /** A class on the marker */
  className?: string
  /** A style on the marker, e.g. its colour */
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { offset, dragOver } = useContext(DragstateContext)
  const [origin, setOrigin] = useState<{ top: number, left: number } | null>(null)

  // The drop target is in viewport coordinates; the marker is placed in its
  // positioned parent
  useLayoutEffect(() => {
    const parent = ref.current?.offsetParent ?? ref.current?.parentElement
    if (dragOver && parent) {
      const { top, left } = parent.getBoundingClientRect()
      setOrigin({ top, left })
    }
  }, [dragOver, offset])

  const pos: React.CSSProperties = { display: 'none' }

  if (dragOver && offset && origin) {
    if (offset.around) {
      const { top, bottom, left, right } = offset.around
      pos.display = 'block'
      pos.top = top - origin.top
      pos.left = left - origin.left
      pos.width = right - left
      pos.height = bottom - top
      pos.backgroundColor = 'rgba(191, 191, 191, 0.4)'
      pos.borderRadius = '4px'
    } else if (offset.line) {
      // Centred on the line between the blocks, whatever height it is styled
      pos.display = 'block'
      pos.top = offset.line.top - origin.top
      pos.transform = 'translateY(-50%)'
      pos.left = offset.line.left - origin.left
      pos.width = offset.line.width
    }
  }

  const dragOverState = !dragOver ? 'none' : offset?.around ? 'around' : 'between'

  return (
    <div
      ref={ref}
      className={className}
      data-dragover={dragOverState}
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        margin: 0,
        userSelect: 'none',
        height: HEIGHT,
        backgroundColor: 'rgb(191, 191, 191)',
        borderRadius: '2px',
        ...pos,
        ...style
      }}
    />
  )
}
