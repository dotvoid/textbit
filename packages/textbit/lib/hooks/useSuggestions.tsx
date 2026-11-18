import { useContext, useMemo } from 'react'
import { SuggestionsContext, type SuggestionsPlacement, type SuggestionsValue } from '../contexts/SuggestionsContext'

/**
 * The suggestions in the document, each suggested block as the editor shows
 * it, in document order, and accepting and rejecting them: to build a review
 * panel of your own, or to say how many wait.
 */
export const useSuggestions = (): SuggestionsValue => {
  const { suggestions, shown, accept, reject } = useContext(SuggestionsContext)
  return useMemo(() => ({ suggestions, shown, accept, reject }), [suggestions, shown, accept, reject])
}

/** The same, with where each block shows: for the editor's own rendering */
export const useSuggestionPlacement = (): SuggestionsPlacement => useContext(SuggestionsContext)
