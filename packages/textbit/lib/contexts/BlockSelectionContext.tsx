import { createContext } from 'react'

/** Whole top-level blocks selected, from one index to another, both included */
export interface BlockSelectionState {
  /** Where the selection started: it stays */
  anchorIndex: number
  /** Where it ends now: Shift+Up/Down moves it */
  focusIndex: number
}

export const BlockSelectionContext = createContext<BlockSelectionState | null>(null)
