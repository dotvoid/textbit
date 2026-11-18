import { createContext } from 'react'
import type { Element } from 'slate'
import type { SuggestedBlock, Suggestion } from '../suggestions/types'
import type { TextChange } from '../utils/diffWords'

/** A block of a suggestion as this editor shows it */
export interface ShownSuggestion {
  /** The suggestion the block is part of */
  suggestion: Suggestion
  /** The suggested block */
  block: SuggestedBlock
  /** 'stale' when the block changed since it was suggested: it can only be rejected */
  state: 'ready' | 'stale'
  /** For a change: word changes per text-holding element, by id, placed in the text as it is */
  texts?: Map<string, TextChange[]>
  /** For a change: whether it changes more than words */
  formatting?: boolean
  /** For an insert: the proposed block */
  node?: Element
}

/** What useSuggestions gives hosts */
export interface SuggestionsValue {
  /** The suggestions in the document, oldest first */
  suggestions: Suggestion[]
  /** Each suggested block as the editor shows it, in document order */
  shown: ShownSuggestion[]
  /** Accept a block of a suggestion, or every block of it that can be */
  accept: (suggestionId: string, blockId?: string) => void
  /** Reject a block of a suggestion, or all of it */
  reject: (suggestionId: string, blockId?: string) => void
}

/** The same, and where in the document each block shows: for the editor itself */
export interface SuggestionsPlacement extends SuggestionsValue {
  /** Changes and deletions, by the id of the block they are on */
  onBlock: Map<string, ShownSuggestion>
  /** Inserted blocks, by the id of the block they follow, or '' for the start */
  after: Map<string, ShownSuggestion[]>
}

export const SuggestionsContext = createContext<SuggestionsPlacement>({
  suggestions: [],
  shown: [],
  onBlock: new Map(),
  after: new Map(),
  accept: () => {},
  reject: () => {}
})
