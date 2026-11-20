import { createContext } from 'react'
import type { SuggestedChange } from '../suggestions/changes'

/** What `useSuggestions` gives */
export interface SuggestionsValue {
  /** Whether the editor shows a fork of the text through a diff renderer, so there are suggestions to show */
  enabled: boolean
  /** The suggested changes, in the order of the text */
  changes: SuggestedChange[]
  /** Accepts a change into the shared text */
  accept: (change: SuggestedChange) => void
  /** Rejects a change */
  reject: (change: SuggestedChange) => void
  /** Accepts every change */
  acceptAll: () => void
  /** Rejects every change */
  rejectAll: () => void
}

export const SuggestionsContext = createContext<SuggestionsValue>({
  enabled: false,
  changes: [],
  accept: () => {},
  reject: () => {},
  acceptAll: () => {},
  rejectAll: () => {}
})
