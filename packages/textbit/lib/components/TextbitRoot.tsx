import type { PlaceholdersVisibility } from '../contexts/TextbitContext'
import { TextbitProvider } from '../contexts/TextbitProvider'
import { PluginRegistryProvider } from '../contexts/PluginRegistry/PluginRegistryProvider'
import type { Plugin, SpellingError } from '../types'
import type { Awareness } from '@y/protocols/awareness'

import { editorPlugins } from '../editor/editorPlugins'
import { ContextMenuHintsProvider } from './ContextMenu/ContextMenuHintsProvider'
import { SelectionBoundsProvider } from '../contexts/SelectionBoundsProvider'
import { Descendant } from 'slate'
import * as Y from '@y/y'
import type { TBCursorOptions } from '../yjs/cursors'
import type { TBRenderer } from '../yjs/model'
import { SlateContainer } from './SlateContainer'
import { GutterProvider } from './GutterProvider/GutterProvider'
import type { TextbitLabels } from '../contexts/TextbitContext'
import type { Comments } from '../comments/types'

/** What every kind of `Textbit.Root` takes */
export interface TextbitRootBaseProps {
  /** The editable and anything else of the editor: menus, toolbar, markers */
  children: React.ReactNode
  /** Log to the console what plugins are registered and replaced, and show selection details. Default: `false`. */
  verbose?: boolean
  /** Milliseconds `onChange` waits for typing to pause. Default: `250`. */
  debounce?: number
  /** Show the document without letting anyone change it. Default: `false`. */
  readOnly?: boolean
  /**
   * Check spelling: given the text of changed blocks with their language,
   * return, for each, the errors found in it. Errors show underlined, with
   * suggestions in the context menu.
   *
   * ```ts
   * onSpellcheck={async (texts) => Promise.all(texts.map(({ text, lang }) => checker.check(text, lang)))}
   * ```
   */
  onSpellcheck?: (texts: { lang: string, text: string }[]) => Promise<Omit<SpellingError, 'id'>[][]>
  /** Milliseconds the spellcheck waits for typing to pause. Default: `1250`. */
  spellcheckDebounce?: number
  /**
   * Hints in empty text: `'multiple'` shows each element's own hint, from its
   * plugin; `'single'` shows `placeholder` while the whole document is empty;
   * `'none'` shows none. Default: `'none'`.
   */
  placeholders?: PlaceholdersVisibility
  /** The hint `placeholders: 'single'` shows */
  placeholder?: string
  /**
   * The plugins. Core's own come first by itself. Without any, the editor has
   * a plain paragraph only; with your own, add `Textbit.Plugins` to keep it.
   */
  plugins?: Plugin[]
  /** A class on the editor's outer element */
  className?: string
  /** A style on the editor's outer element */
  style?: React.CSSProperties
  /** The writing direction. Default: `'ltr'`. */
  dir?: 'ltr' | 'rtl'
  /** The document's language, e.g. `'sv'`, for spelling and typography. Default: `'en'`. */
  lang?: string
  /** Text textbit itself shows, e.g. translations */
  labels?: Partial<TextbitLabels>
  /**
   * Milliseconds what an agent changed stays marked in the text, from when
   * this editor first shows it, before it fades. 0 keeps it until dismissed.
   * Default: 8000.
   */
  agentChangeDuration?: number
  /**
   * Where comments on the text are kept: `createCommentStore` for comments the
   * host saves itself, or a collaboration server's store for the text field.
   * The editor highlights each thread's text; `useComments` gives the rest.
   */
  comments?: Comments
}

/** A root editing plain text: the value is a string, a paragraph per line */
export interface TextbitRootStringProps extends TextbitRootBaseProps {
  /** The text, read when the editor mounts */
  value: string
  /** The text after a change */
  onChange?: (value: string) => void
}

/** A root editing a document it holds */
export interface TextbitRootDefaultProps extends TextbitRootBaseProps {
  /** The document, read when the editor mounts */
  value: Descendant[]
  /** The document after a change */
  onChange?: (value: Descendant[]) => void
}

/** A root editing a shared document, without cursors */
export interface TextbitRootYjsProps extends TextbitRootBaseProps {
  /**
   * A text field of a shared Y.js 14 document: the `Y.Node` holding its blocks,
   * e.g. `ydoc.get('body')`. Fill a new one once with `seedField`.
   */
  value: Y.Node
  /** Show the field through a Y.js 14 renderer, such as the suggestions view of a fork */
  renderer?: TBRenderer
  /** The document after a change, by anyone */
  onChange?: (value: Descendant[]) => void
}

/** A root editing a shared document with others: cursors and presence through awareness */
export interface TextbitRootCollaborationProps extends TextbitRootYjsProps {
  /** The awareness of the connection to the shared document, e.g. a provider's */
  awareness?: Awareness | null
  /**
   * This person's cursor, as others see it: `data.name` and `data.color` label
   * it. Sent while the editable has focus, so another editor on the same
   * document in the page never moves it.
   */
  cursor?: TBCursorOptions
}

/** Any of the kinds of root props */
export type TextbitRootProps = TextbitRootStringProps | TextbitRootDefaultProps | TextbitRootYjsProps | TextbitRootCollaborationProps

/**
 * The editor: its document, plugins and options. The editable and everything
 * else of the editor go inside it. The value is read when it mounts; later
 * changes come through `onChange`.
 *
 * ```tsx
 * <Textbit.Root value={document} onChange={save} plugins={plugins}>
 *   <Textbit.Editable aria-label='Article' />
 * </Textbit.Root>
 * ```
 */
export function TextbitRoot(props: TextbitRootStringProps): React.ReactElement
/** A root holding its document */
export function TextbitRoot(props: TextbitRootDefaultProps): React.ReactElement
/** A root on a shared document */
export function TextbitRoot(props: TextbitRootCollaborationProps): React.ReactElement
export function TextbitRoot(props: TextbitRootProps) {
  const {
    children,
    verbose,
    readOnly,
    debounce,
    spellcheckDebounce,
    placeholders,
    plugins,
    className,
    style: inStyle,
    placeholder
  } = props

  const style: React.CSSProperties = {
    boxSizing: 'border-box',
    textRendering: 'optimizeLegibility',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    ...inStyle,
  }

  return (
    <div className={className} style={style} data-tb='editor'>
      <TextbitProvider
        verbose={!!verbose}
        readOnly={readOnly}
        collaborative={!readOnly && isTextbitRootCollaborationProps(props)}
        debounce={debounce}
        spellcheckDebounce={spellcheckDebounce}
        placeholders={placeholders}
        placeholder={placeholder}
        labels={props.labels}
        agentChangeDuration={props.agentChangeDuration}
        dir={props.dir}
        lang={props.lang}
      >
        <PluginRegistryProvider
          verbose={!!verbose}
          plugins={editorPlugins(plugins)}
        >
          {/* @ts-expect-error - Props are correctly typed at the public interface level */}
          <SlateContainer {...props}>
            <SelectionBoundsProvider>
              <ContextMenuHintsProvider>
                <GutterProvider>
                  {children}
                </GutterProvider>
              </ContextMenuHintsProvider>
            </SelectionBoundsProvider>
          </SlateContainer>
        </PluginRegistryProvider>
      </TextbitProvider>
    </div>
  )
}

function isTextbitRootCollaborationProps(
  props: TextbitRootProps
): props is TextbitRootCollaborationProps {
  return props.value instanceof Y.Node && 'awareness' in props && props.awareness != null
}
