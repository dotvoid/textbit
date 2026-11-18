import { useContext, useEffect, useState } from 'react'
import { SelectionBoundsContext } from '../contexts/SelectionBoundsContext'

/**
 * Non reactive hook
 */
export const useSelectionBoundsNonReactive = () => {
  const context = useContext(SelectionBoundsContext)

  if (!context) {
    throw new Error('useSelectionBounds must be used within a SelectionBoundsProvider')
  }

  return context.boundsRef
}


/**
 * Where the selection is on screen, updated as it moves: to place a toolbar or
 * popup of your own beside it. Undefined while there is none.
 */
export const useSelectionBounds = () => {
  const context = useContext(SelectionBoundsContext)

  if (!context) {
    throw new Error('useTextbitSelectionBoundsState must be used within a TextbitSelectionBoundsProvider')
  }

  const [bounds, setBounds] = useState(context.boundsRef.current)

  useEffect(() => {
    return context.subscribe(setBounds)
  }, [context])

  return bounds
}
