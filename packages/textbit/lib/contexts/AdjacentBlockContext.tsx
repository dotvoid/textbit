import { createContext } from 'react'
import type { AdjacentBlockState } from '../types/adjacentBlock'

export type { AdjacentBlockState }

export const AdjacentBlockContext = createContext<AdjacentBlockState | null>(null)

// Internal: lets components inside the editor leave the parked caret, e.g. after
// inserting text beside the block.
export const SetAdjacentBlockContext = createContext<(state: AdjacentBlockState | null) => void>(
  () => {}
)
