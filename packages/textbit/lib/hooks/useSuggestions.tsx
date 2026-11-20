import { useContext } from 'react'
import { SuggestionsContext, type SuggestionsValue } from '../contexts/SuggestionsContext'

/**
 * The suggested changes of an editor showing a fork of the text, in the order
 * of the text, and accepting and rejecting them: to build a review panel of
 * your own, or to say how many wait
 */
export const useSuggestions = (): SuggestionsValue => useContext(SuggestionsContext)
