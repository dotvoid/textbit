import type { BaseEditor, BaseElement, BaseRange, BaseText, Element } from 'slate'
import type { ReactEditor } from 'slate-react'
import type { HistoryEditor } from 'slate-history'
import { DebounceFunction } from '../utils/debounce'
import type { PendingDropsController } from './pendingDrops'

/**
 * A word or phrase the spellcheck function flagged, with what could replace
 * it. Your `onSpellcheck` function returns these without `id`; the editor
 * adds one.
 */
export type SpellingError = {
  /** Given by the editor, to tell errors apart */
  id: string
  /** The text that is flagged */
  text: string
  /** `'error'` is underlined as a mistake, `'suggestion'` more gently. Default: `'error'`. */
  level?: 'error' | 'suggestion'
  /** Replacements to offer, best first */
  suggestions: Array<{
    /** The replacement text */
    text: string
    /** Why, shown beside it */
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

/** @internal The spellcheck results, by top-level element id */
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

/**
 * The editor: Slate's, with React's and history's additions, and textbit's.
 * It is the type of `useEditor()` and of what `createTextbitEditor` returns.
 *
 * It includes React's editor (`ReactEditor`) also for an editor made by
 * `createTextbitEditor`, which has no DOM: the DOM functions of `ReactEditor`
 * do not work on that one.
 */
export type TextbitEditor = BaseEditor & ReactEditor & HistoryEditor & {
  /** @internal The spellcheck results, by top-level element id */
  spellingLookupTable: Map<string, {
    lang: string
    text: string
    errors: SpellingError[]
  }>
  /** @internal Runs the spellcheck; set when `onSpellcheck` is given */
  spellcheck?: DebounceFunction<() => void>
  /** @internal Called with the results of each spellcheck */
  onSpellcheckComplete: (cb: (lookupTable: SpellcheckLookupTable, updatedNodes: string[]) => void) => void
  /** The document's language, e.g. `'en'`: the `lang` option, else the page's, else `'en'` */
  lang: string
  /** Whether a value is an element of class text */
  isTextBlock: (value: unknown) => value is Element
  /** Whether a value is an element of the given type */
  isOfType: <T extends Element>(value: unknown, type: string) => value is T
  /** @internal Whether whitespace may lead or trail a paragraph */
  allowEdgeWhitespace?: boolean
  /** @internal Uploads and drops in progress, while an editable shows the editor */
  pendingDrops?: PendingDropsController
}

/** @inline */
type BaseTextbitElement = BaseElement & {
  /** What the element is; see {@link TextbitElement} */
  class: 'leaf' | 'inline' | 'text' | 'block' | 'void'
  /** The element's type: a plugin's name, or a child's full type such as `base/image/caption` */
  type: string
  /** @internal */
  hotKey?: string
  /** The language of this element when it differs from the document's, e.g. `'sv'` */
  lang?: string
  /** HTML attributes an element carries in the document, as a plugin sets them */
  attributes?: Record<string, string | number>
}

/**
 * An element of a textbit document: a block, a child of one, an inline
 * element, or a void. Its `class` says which:
 *
 * - `text`: holds text (and inline elements), like a paragraph or a caption.
 *   Its `id` may be missing in old documents; the editor gives new ones ids.
 * - `block`: holds other elements, like an image with its fields.
 * - `void`: holds no editable text, like the picture of an image.
 * - `inline`: sits in text, like a link.
 *
 * `properties` holds what the element's plugin stores: plain strings, numbers
 * and booleans. For text, `role` names a variant, such as `heading-1`.
 *
 * ```ts
 * const paragraph: TBElement = {
 *   id: crypto.randomUUID(),
 *   type: 'base/text',
 *   class: 'text',
 *   properties: {},
 *   children: [{ text: 'Hello' }]
 * }
 * ```
 */
export type TextbitElement =
  | (BaseTextbitElement & {
      /** A unique id; may be missing on text elements of old documents */
      id?: string
      /** Text: holds text and inline elements */
      class: 'text'
      /** The element's type, such as `base/text` */
      type: string
      /** What the plugin stores; `role` names a variant, such as `heading-1` */
      properties?: {
        /** A variant of the text, such as `heading-1` or `preamble`; none for plain text */
        role?: string
        [key: string]: string | number | boolean | undefined
      }
    })
  | (BaseTextbitElement & {
      /** A unique id */
      id: string
      /** What the element is; see {@link TextbitElement} */
      class: 'leaf' | 'inline' | 'block' | 'void'
      /** The element's type: a plugin's name, or a child's full type such as `base/image/caption` */
      type: string
      /** What the plugin stores */
      properties?: {
        [key: string]: string | number | boolean | undefined
      }
    })

/**
 * A run of text. Marks are keys named after their plugin, set to `true`:
 * `{ text: 'bold words', 'base/bold': true }`.
 */
export type TextbitText = BaseText & {
  /** The text */
  text: string
  /** @internal Set on the empty text of an empty element, to show its hint */
  placeholder?: string
  [key: string]: boolean | string | undefined
}

/**
 * A range in a document: Slate's, with what the editor's own decorations set
 * on the text they cover. Those keys are the editor's; hosts mark text with
 * `Textbit.Editable`'s `decorations` instead.
 */
export type TextbitRange = BaseRange & {
  /** @internal */
  placeholder?: React.ReactNode
  /** @internal */
  spellingError?: SpellingError
  /** @internal Set alongside spellingError, never instead of it: accepted words stay marked */
  spellingAccepted?: boolean
  /** @internal */
  nbsp?: boolean
  /** @internal */
  newline?: boolean
  /** @internal Text an agent added: its change's id */
  agentChange?: string
  /** @internal The agent's colour */
  agentColor?: string
  /** @internal Text an agent removed, shown struck through before (or after) this text */
  agentRemoved?: string
  /** @internal */
  agentRemovedAt?: 'before' | 'after'
  /** @internal The change is fading out */
  agentFading?: boolean
  /** @internal The agent's name, on the first of its changes in a block */
  agentName?: string
  /** @internal Text a suggestion removes */
  suggestDelete?: boolean
  /** @internal Text a suggestion adds beside this text */
  suggestInsert?: string
  /** @internal */
  suggestInsertAt?: 'before' | 'after'
  /** @internal The new text replaces the struck text before it */
  suggestReplaces?: boolean
  /** @internal */
  suggestColor?: string
  /** @internal The suggestion is out of date */
  suggestStale?: boolean
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
