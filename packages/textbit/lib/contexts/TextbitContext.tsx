import { createContext } from 'react'

export type PlaceholdersVisibility = 'none' | 'single' | 'multiple'

export interface TextbitStats {
  full: { words: number, characters: number }
  short: { words: number, characters: number }
}

/** Text textbit itself shows, for a host to translate */
export interface TextbitLabels {
  /** Action on an object whose plugin is missing: turn it into paragraphs */
  unknownToText: string
  /** Action on an object whose plugin is missing: remove it */
  unknownRemove: string
  /** On a block an agent works on; {name} is the agent's name */
  agentReading: string
  agentWriting: string
  agentThinking: string
}

export const DEFAULT_LABELS: TextbitLabels = {
  unknownToText: 'Convert to text',
  unknownRemove: 'Remove',
  agentReading: '{name} is reading',
  agentWriting: '{name} is writing',
  agentThinking: '{name} is thinking'
}

export interface TextbitState {
  verbose: boolean
  readOnly: boolean
  collaborative: boolean
  dir: 'ltr' | 'rtl'
  lang: string
  debounce: number
  spellcheckDebounce: number
  placeholder: string
  placeholders: PlaceholdersVisibility
  stats: TextbitStats
  labels: TextbitLabels
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
  placeholders: 'none',
  stats: {
    full: { words: 0, characters: 0 },
    short: { words: 0, characters: 0 }
  },
  labels: DEFAULT_LABELS,
  dispatch: () => { }
}

export const TextbitContext = createContext<TextbitState | undefined>(initialState)
