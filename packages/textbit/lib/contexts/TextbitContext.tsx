import { createContext } from 'react'

/** Which hints empty text shows; see `placeholders` on `Textbit.Root` */
export type PlaceholdersVisibility = 'none' | 'single' | 'multiple'

/** @inline */
type Count = {
  /** Words: runs of letters */
  words: number
  /** Characters, spaces included, each block's text trimmed at its ends */
  characters: number
}

/** Words and characters in a document */
export interface TextbitStats {
  /** In all text, fields of objects included */
  full: Count
  /**
   * In the top-level paragraphs and headings (`base/text`) only, leaving out
   * those with the role `vignette`: the running text
   */
  short: Count
}

/** Text textbit itself shows, for a host to translate */
export interface TextbitLabels {
  /** Action on an object whose plugin is missing: turn it into paragraphs */
  unknownToText: string
  /** Action on an object whose plugin is missing: remove it */
  unknownRemove: string
  /** On a block an agent reads; `{name}` is the agent's name. Default: `{name} is reading`. */
  agentReading: string
  /** On a block an agent writes in. Default: `{name} is writing`. */
  agentWriting: string
  /** On a block while an agent thinks. Default: `{name} is thinking`. */
  agentThinking: string
  /** Announced when an agent replaces text; `{name}`, `{added}` and `{removed}` are filled in */
  agentReplaced: string
  /** Announced when an agent adds text */
  agentAdded: string
  /** Announced when an agent removes text */
  agentDeleted: string
  /** A suggestion adding text: `{name}` and `{added}` are filled in */
  suggestionAdds: string
  /** A suggestion removing text: `{name}` and `{removed}` */
  suggestionRemoves: string
  /** A suggestion replacing text: `{name}`, `{removed}` and `{added}` */
  suggestionReplaces: string
  /** Who suggested, when it is not known. Default: `Someone`. */
  suggestionSomeone: string
  /** The button accepting a suggestion. Default: `Accept`. */
  suggestionAccept: string
  /** The button rejecting a suggestion. Default: `Reject`. */
  suggestionReject: string
  /** The button accepting every suggestion. Default: `Accept all`. */
  suggestionAcceptAll: string
  /** The button rejecting every suggestion. Default: `Reject all`. */
  suggestionRejectAll: string
  /** Announced when suggestions arrive: `{name}` and `{count}` changes */
  suggestionArrived: string
}

export const DEFAULT_LABELS: TextbitLabels = {
  unknownToText: 'Convert to text',
  unknownRemove: 'Remove',
  agentReading: '{name} is reading',
  agentWriting: '{name} is writing',
  agentThinking: '{name} is thinking',
  agentReplaced: '{name} changed “{removed}” to “{added}”',
  agentAdded: '{name} added “{added}”',
  agentDeleted: '{name} removed “{removed}”',
  suggestionAdds: '{name} adds “{added}”',
  suggestionRemoves: '{name} removes “{removed}”',
  suggestionReplaces: '{name} replaces “{removed}” with “{added}”',
  suggestionSomeone: 'Someone',
  suggestionAccept: 'Accept',
  suggestionReject: 'Reject',
  suggestionAcceptAll: 'Accept all',
  suggestionRejectAll: 'Reject all',
  suggestionArrived: '{name} suggests {count} changes'
}

/** The editor's options and state, as `useTextbit()` gives them; see `Textbit.Root` */
export interface TextbitState {
  /** Whether verbose logging is on */
  verbose: boolean
  /** Whether the editor is read-only */
  readOnly: boolean
  /** Whether others edit the same document: a shared document with awareness, not read-only */
  collaborative: boolean
  /** The writing direction */
  dir: 'ltr' | 'rtl'
  /** The document's language */
  lang: string
  /** Milliseconds `onChange` waits */
  debounce: number
  /** Milliseconds the spellcheck waits */
  spellcheckDebounce: number
  /** The hint for `placeholders: 'single'` */
  placeholder: string
  /** Which hints empty text shows */
  placeholders: PlaceholdersVisibility
  /** Words and characters in the document, after the last change */
  stats: TextbitStats
  /** Text textbit shows, translations filled in */
  labels: TextbitLabels
  /** Milliseconds what an agent changed stays marked in the text; 0 until dismissed */
  agentChangeDuration: number
  /** @internal */
  dispatch: React.Dispatch<Partial<TextbitState>>
}

const initialState: TextbitState = {
  verbose: false,
  readOnly: false,
  collaborative: false,
  dir: 'ltr',
  lang: 'en',
  debounce: 250,
  spellcheckDebounce: 1250,
  placeholder: '',
  agentChangeDuration: 8000,
  placeholders: 'none',
  stats: {
    full: { words: 0, characters: 0 },
    short: { words: 0, characters: 0 }
  },
  labels: DEFAULT_LABELS,
  dispatch: () => { }
}

export const TextbitContext = createContext<TextbitState | undefined>(initialState)
