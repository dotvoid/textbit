import { createEditor, type Descendant, type Editor } from 'slate'
import { withHistory } from 'slate-history'
import { withCursors, withYHistory, withYjs, YjsEditor } from '@slate-yjs/core'
import type * as Y from 'yjs'
import { SUGGESTIONS_MAP } from '../suggestions/store'
import type { Awareness } from 'y-protocols/awareness'
import type { PluginDefinition } from '../types'
import type { PluginRegistryComponent } from '../contexts/PluginRegistry/lib/types'
import { createRegistry } from '../contexts/PluginRegistry/lib/createRegistry'
import { editorPlugins } from './editorPlugins'
import { rememberPlugins } from './pluginsOf'
import { withLang } from '../with/withLang'
import { withSpeling, type OnSpellcheckCallback } from '../with/withSpeling'
import { withTextbitElements } from '../with/withTextbitElements'
import { withInsertText } from '../with/withInsertText'
import { withNormalizeNode } from '../with/withNormalizeNode'
import { withEditableVoids } from '../with/withEditableVoids'
import { withInsertBreak } from '../with/withInsertBreak'
import { withInsertSoftBreak } from '../with/withInsertSoftBreak'
import { withInsertHtml } from '../with/withInsertHtml'
import { withClipboard } from '../with/withClipboard'
import { withUniqueIds } from '../with/withUniqueIds'
import { withDeletionManagement } from '../with/withDeletionManagement'
import { withBlockBoundaryGuard } from '../with/withBlockBoundaryGuard'
import { withInsertFragment } from '../with/withInsertFragment'
import { withTrimWhitespace } from '../with/withTrimWhitespace'
import { withSelectionGuard } from '../with/withSelectionGuard'
import { withRemoteDeltaGuard } from '../with/withRemoteDeltaGuard'

/** What `createTextbitEditor` takes */
export interface TextbitEditorOptions {
  /** The plugins, after core's own. Without any, a plain text block. Plugins with views work too; the views are not used. */
  plugins?: PluginDefinition[]
  /**
   * The document's language, e.g. `'sv'`. Default: the page's (`<html lang>`),
   * else the runtime's (`navigator.language`), else `'en'`.
   */
  lang?: string
  /** The content, when not shared through `shared` */
  value?: Descendant[]
  /**
   * Collaborate through a shared Y.js document. Call `YjsEditor.connect` on
   * the editor to start, and `YjsEditor.disconnect` when done.
   */
  shared?: Y.XmlText
  /** The origin of this editor's own changes to the shared document */
  localOrigin?: symbol
  /** Share a cursor through this awareness, with a shared document */
  awareness?: Awareness
  /** The cursor shared through `awareness` */
  cursor?: {
    /** The awareness field of the cursor's position. Default: Slate's. */
    stateField?: string
    /** The awareness field of `data`. Default: Slate's. */
    dataField?: string
    /** Whether the cursor is sent as it moves. Default: `true`. */
    autoSend?: boolean
    /** Shown to others, e.g. `{ name, color }` */
    data?: Record<string, unknown>
  }
  /** Check spelling, as `onSpellcheck` on `Textbit.Root` does */
  onSpellcheck?: OnSpellcheckCallback
  /** Milliseconds the spellcheck waits for changes to pause. Default: `1250`, as in `Textbit.Root`. */
  spellcheckDebounce?: number
  /** The editor to build on, such as one made with slate-react's withReact */
  editor?: Editor
}

/**
 * A textbit editor without a user interface: the document, its rules and
 * commands, as the editable uses them. It runs wherever Slate does, a server
 * included, to read, change or check a document with the same plugins.
 */
export function createTextbitEditor(options: TextbitEditorOptions = {}): Editor {
  const { components, plugins } = createRegistry(editorPlugins(options.plugins))

  const editor = withTextbit(options.editor ?? createEditor(), { ...options, plugins, components })
  if (options.value && !options.shared) {
    editor.children = options.value
  }
  return editor
}

/**
 * Make an editor a textbit editor for a registry's plugins and components.
 * The order matters: each plugin wraps the ones before it.
 */
export function withTextbit(
  base: Editor,
  options: Omit<TextbitEditorOptions, 'plugins' | 'editor'> & {
    plugins: PluginDefinition[]
    components: Map<string, PluginRegistryComponent>
  }
): Editor {
  const { plugins, components } = options
  let editor = base
  rememberPlugins(base, plugins)

  if (!options.shared) {
    editor = withHistory(editor)
  } else {
    editor = withYHistory(withYjs(editor, options.shared, {
      localOrigin: options.localOrigin ?? Symbol('textbit-editor')
    }))

    // A person's own accepts and rejects of suggestions are undone like their edits
    if (YjsEditor.isYjsEditor(editor) && options.shared.doc) {
      (editor as typeof editor & { undoManager: Y.UndoManager }).undoManager.addToScope(options.shared.doc.getMap(SUGGESTIONS_MAP))
    }

    if (YjsEditor.isYjsEditor(editor) && options.awareness) {
      editor = withCursors(editor, options.awareness, {
        autoSend: options.cursor?.autoSend ?? true,
        data: options.cursor?.data,
        cursorStateField: options.cursor?.stateField,
        cursorDataField: options.cursor?.dataField
      })
    }

    // Outermost of the yjs plugins, so it hands every inner one a private
    // copy of each remote delta. Required whenever more than one editor is
    // bound to the same shared root in this client.
    if (YjsEditor.isYjsEditor(editor)) {
      withRemoteDeltaGuard(editor)
    }
  }

  withLang(editor, options.lang)
  if (options.onSpellcheck) {
    withSpeling(editor, options.onSpellcheck, options.spellcheckDebounce ?? 1250)
  }
  withTextbitElements(editor)
  withInsertText(editor, plugins)
  withInsertFragment(editor, components)
  withNormalizeNode(editor, plugins, components)
  withEditableVoids(editor, components)
  withTrimWhitespace(editor)
  withInsertBreak(editor, components)
  withInsertSoftBreak(editor, components)
  withInsertHtml(editor, components, plugins)
  withClipboard(editor, components)
  withUniqueIds(editor)
  withDeletionManagement(editor)
  // After the command plugins, so it wraps their final versions and its
  // guard runs first; constrains edits to a selection that crosses a block
  // boundary.
  withBlockBoundaryGuard(editor)
  // Last, so its after-apply check sees the final state of every inner plugin.
  withSelectionGuard(editor)

  return editor
}
