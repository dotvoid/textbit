import { createContext } from 'react'
import type { Element } from 'slate'
import type { SuggestedBlock, Suggestion } from '../suggestions/types'
import type { TextChange } from '../utils/diffWords'

/** A block of a suggestion as this editor shows it */
export interface ShownSuggestion {
  suggestion: Suggestion
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

export interface SuggestionsValue {
  suggestions: Suggestion[]
  /** Changes and deletions, by the id of the block they are on */
  onBlock: Map<string, ShownSuggestion>
  /** Inserted blocks, by the id of the block they follow, or '' for the start */
  after: Map<string, ShownSuggestion[]>
  accept: (suggestionId: string, blockId?: string) => void
  reject: (suggestionId: string, blockId?: string) => void
}

export const SuggestionsContext = createContext<SuggestionsValue>({
  suggestions: [],
  onBlock: new Map(),
  after: new Map(),
  accept: () => {},
  reject: () => {}
})
