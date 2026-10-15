import type { BaseEditor, BaseElement, BaseRange, BaseText, Element } from 'slate'
import type { ReactEditor } from 'slate-react'
import type { HistoryEditor } from 'slate-history'
import { DebounceFunction } from '../utils/debounce'
import type { PendingDropsController } from '../contexts/PendingDropsContext'

export type SpellingError = {
  id: string
  text: string
  level?: 'error' | 'suggestion'
  suggestions: Array<{
    text: string
    description?: string
  }>
}

/**
 * A caller-supplied highlight over a range of text. Rendered on every leaf it
 * covers as `data-tb-mark` (space-separated ids) plus the class `tb-mark`.
 */
export interface Decoration {
  /**
   * Caller's id for this mark. The same id may appear on several decorations
   * (a mark spanning blocks).
   */
  id: string
  /**
   * A Slate range in the editor's current document. Paths and offsets are not
   * tracked through edits; the caller keeps them fresh.
   */
  range: BaseRange
}

export type SpellcheckLookupTable = Map<string, {
  lang: string
  text: string
  errors: SpellingError[]
}>

export type SpellcheckFunction = {
  (): void
  force: () => void
  cancel: () => void
}

export type TextbitEditor = BaseEditor & ReactEditor & HistoryEditor & {
  spellingLookupTable: Map<string, {
    lang: string
    text: string
    errors: SpellingError[]
  }>
  spellcheck?: DebounceFunction<() => void>
  onSpellcheckComplete: (cb: (lookupTable: SpellcheckLookupTable, updatedNodes: string[]) => void) => void
  lang: string
  isTextBlock: (value: unknown) => value is Element
  isOfType: <T extends Element>(value: unknown, type: string) => value is T
  allowEdgeWhitespace?: boolean
  pendingDrops?: PendingDropsController
}

type BaseTextbitElement = BaseElement & {
  class: 'leaf' | 'inline' | 'text' | 'block' | 'void'
  type: string
  hotKey?: string
  lang?: string
  attributes?: Record<string, string | number>
}

export type TextbitElement =
  | (BaseTextbitElement & {
      id?: string
      class: 'text'
      type: string
      properties?: {
        role?: string
        [key: string]: string | number | boolean | undefined
      }
    })
  | (BaseTextbitElement & {
      id: string
      class: 'leaf' | 'inline' | 'block' | 'void'
      type: string
      properties?: {
        [key: string]: string | number | boolean | undefined
      }
    })

export type TextbitText = BaseText & {
  text: string
  placeholder?: string
  [key: string]: boolean | string | undefined
}

export type TextbitRange = BaseRange & {
  placeholder?: React.ReactNode
  spellingError?: SpellingError
  // Set alongside spellingError, never instead of it - accepted words stay marked.
  spellingAccepted?: boolean
  nbsp?: boolean
  newline?: boolean
}

// Declare module augmentation
declare module 'slate' {
  interface CustomTypes {
    Editor: TextbitEditor
    Element: TextbitElement
    Text: TextbitText
    Range: TextbitRange
  }
}
