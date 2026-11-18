import { useContext } from 'react'
import { SuggestionsContext, type SuggestionsValue } from '../contexts/SuggestionsContext'

/** The suggestions in the document, where they show, and accepting and rejecting them */
export const useSuggestions = (): SuggestionsValue => useContext(SuggestionsContext)
