import { createContext } from 'react'

export interface AdjacentBlockState {
  blockId: string
  direction: 'before' | 'after' // 'before' = cursor arrived from preceding block, 'after' = from following block
}

export const AdjacentBlockContext = createContext<AdjacentBlockState | null>(null)

// Internal: lets components inside the editor leave the parked caret, e.g. after
// inserting text beside the block.
export const SetAdjacentBlockContext = createContext<(state: AdjacentBlockState | null) => void>(
  () => {}
)
