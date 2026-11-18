import { useContext } from 'react'
import { BlockSelectionContext, type BlockSelectionState } from '../contexts/BlockSelectionContext'

/**
 * Whole blocks selected, as when an object is clicked or Shift+Up/Down
 * extends past a block, or null. Indexes of top-level blocks.
 */
export function useBlockSelection(): BlockSelectionState | null {
  return useContext(BlockSelectionContext)
}
