import { useCallback, useMemo, useState } from 'react'
import { TextbitContext, type TextbitState, type TextbitStats, type PlaceholdersVisibility } from './TextbitContext'

interface TextbitProps {
  children: React.ReactNode
  verbose?: boolean
  readOnly?: boolean
  collaborative?: boolean
  dir?: 'ltr' | 'rtl'
  lang?: string
  debounce?: number
  spellcheckDebounce?: number
  placeholder?: string
  placeholders?: PlaceholdersVisibility
}

// Prop-driven fields are read from props each render via useMemo.
// The previous useReducer(reducer, initialArg) shape latched the
// initialArg only on first render, so subsequent prop updates
// (e.g. a host component flipping `readOnly` after a workflow
// transition) never reached descendants that read via
// useTextbit(). Only `stats` is mutable at runtime through
// dispatch calls from SlateContainer, so it lives in useState
// while everything else follows props.
export function TextbitProvider({
  children,
  verbose,
  readOnly,
  collaborative,
  dir,
  lang,
  debounce,
  spellcheckDebounce,
  placeholder,
  placeholders
}: TextbitProps) {
  const [stats, setStats] = useState<TextbitStats>({
    full: { words: 0, characters: 0 },
    short: { words: 0, characters: 0 }
  })

  // Compat shim for the pre-existing dispatch API: SlateContainer
  // dispatches `{ stats }` on every editor change. Any other partial
  // fields silently no-op - props are the source of truth for the
  // rest of TextbitState and mustn't be overridable via dispatch.
  const dispatch = useCallback((action: Partial<TextbitState>) => {
    if (action.stats) setStats(action.stats)
  }, [])

  const value = useMemo<TextbitState>(() => ({
    verbose: verbose ?? false,
    readOnly: readOnly ?? false,
    collaborative: collaborative ?? false,
    dir: dir ?? 'ltr',
    lang: lang ?? 'en',
    debounce: debounce ?? 250,
    spellcheckDebounce: spellcheckDebounce ?? 1250,
    placeholder: placeholder ?? '',
    placeholders: placeholders ?? 'none',
    stats,
    dispatch
  }), [
    verbose,
    readOnly,
    collaborative,
    dir,
    lang,
    debounce,
    spellcheckDebounce,
    placeholder,
    placeholders,
    stats,
    dispatch
  ])

  return (
    <TextbitContext.Provider value={value}>
      {children}
    </TextbitContext.Provider>
  )
}
