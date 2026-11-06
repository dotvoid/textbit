import { useState, useRef, useCallback } from 'react'
import { useSlateStatic } from 'slate-react'
import { DragstateContext } from './DragStateContext'
import { usePluginRegistry } from '../hooks/usePluginRegistry'
import { useTextbit } from '../hooks/useTextbit'
import { dropTargetAt, type DropTarget } from '../utils/dropTarget'
import { pipeFromDrop } from '../utils/pipes'

/**
 * Drag and drop for the whole editing area. Drops are handled here rather than
 * by each block, so the gaps between blocks are drop targets too, and the drop
 * marker and the drop always agree on where a drop goes.
 */
export function DragStateProvider({ children }: {
  children: React.ReactNode
}) {
  const editor = useSlateStatic()
  const { plugins } = usePluginRegistry()
  const { readOnly } = useTextbit()
  const counter = useRef(0)
  const [offset, setOffset] = useState<DropTarget | undefined>(undefined)
  const [dragOver, setDragOver] = useState<boolean>(false)

  const onDragEnter = useCallback(() => {
    setDragOver(true)
    counter.current++
  }, [])

  const onDragLeave = useCallback(() => {
    setTimeout(() => {
      if (--counter.current <= 0) {
        counter.current = 0
        setDragOver(false)
      }
    })
  }, [])

  const onDrop = useCallback(() => {
    counter.current = 0
    setDragOver(false)
  }, [])

  const onDragEnterCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onDragEnter()
  }, [readOnly, onDragEnter])

  const onDragLeaveCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    onDragLeave()
  }, [readOnly, onDragLeave])

  const onDragOverCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setOffset(dropTargetAt(editor, plugins, event.clientY))
  }, [readOnly, editor, plugins])

  const onDropCapture = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) {
      event.preventDefault()
      return
    }
    onDrop()
    // A drop no plugin consumes goes on to slate-react, as it always has
    pipeFromDrop(editor, plugins, event, dropTargetAt(editor, plugins, event.clientY).index)
  }, [readOnly, editor, plugins, onDrop])

  // position: relative places the drop and upload markers
  return (
    <DragstateContext.Provider value={{ dragOver, offset, setOffset, onDragEnter, onDragLeave, onDrop }}>
      <div
        style={{ height: '100%', position: 'relative' }}
        onDragEnterCapture={onDragEnterCapture}
        onDragLeaveCapture={onDragLeaveCapture}
        onDragOverCapture={onDragOverCapture}
        onDropCapture={onDropCapture}
      >
        {children}
      </div>
    </DragstateContext.Provider>
  )
}
