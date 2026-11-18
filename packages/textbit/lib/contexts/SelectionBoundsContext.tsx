import { createContext, RefObject } from 'react'

/** The selection's rectangle on screen, in viewport coordinates, and what it is in */
export type SelectionBounds = Omit<DOMRect & {
  /** Whether it is a caret, not a range */
  isCollapsed: boolean
  /** The rectangle of the top-level block at the selection, while the editor has focus */
  box?: DOMRect
}, 'toJSON'>

export type SelectionBoundsCallback = (param: SelectionBounds | undefined) => void

export const SelectionBoundsContext = createContext<{
  boundsRef: RefObject<SelectionBounds | undefined>
  subscribe: (callback: SelectionBoundsCallback) => () => void
} | undefined>(undefined)
