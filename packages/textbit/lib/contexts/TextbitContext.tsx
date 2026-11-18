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
  /** On a suggestion: who it is from, with {name} */
  suggestionFrom: string
  /** On a suggestion that changes more than words */
  suggestionFormatting: string
  /** On a suggestion whose block changed since */
  suggestionStale: string
  /** The button accepting a suggestion. Default: `Accept`. */
  suggestionAccept: string
  /** The button rejecting a suggestion. Default: `Reject`. */
  suggestionReject: string
  /** Announced when suggestions arrive: {name} and {count} blocks */
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
  suggestionFrom: 'Suggested by {name}',
  suggestionFormatting: 'also formatting',
  suggestionStale: 'changed since',
  suggestionAccept: 'Accept',
  suggestionReject: 'Reject',
  suggestionArrived: '{name} suggests changes to {count} blocks'
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
