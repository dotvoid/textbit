import { createEditor, type Descendant, type Editor } from 'slate'
import { withHistory } from 'slate-history'
import type * as Y from '@y/y'
import type { Awareness } from '@y/protocols/awareness'
import { bindField, reserveBinding } from '../yjs/binding'
import { withSharedCursor, type TBCursorOptions } from '../yjs/cursors'
import type { TBRenderer } from '../yjs/model'
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
   * Edit a text field of a shared Y.js 14 document: a `Y.Node` holding the
   * field's blocks. The editor shows it at once and follows it; `sharedOf(editor)`
   * gives its link to the field, whose `release()` unbinds it.
   */
  shared?: Y.Node
  /** The origin of this editor's own changes to the shared document. Default: a new object. */
  origin?: object
  /** Show the shared field through a Y.js 14 renderer, such as the suggestions view of a fork */
  renderer?: TBRenderer
  /** Share a cursor through this awareness, with a shared document */
  awareness?: Awareness
  /** The cursor shared through `awareness` */
  cursor?: TBCursorOptions
  /** With `awareness`: whether the editor is in use, so its cursor is sent. Default: always. */
  isActive?: () => boolean
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
    /** @internal Leave binding to the shared field to the caller, as React's container does in an effect */
    bind?: boolean
  }
): Editor {
  const { plugins, components } = options
  let editor = base
  rememberPlugins(base, plugins)

  if (!options.shared) {
    editor = withHistory(editor)
  } else if (options.bind === false) {
    // Bound later, at the same place
    reserveBinding(editor)
  } else {
    // Innermost, so every operation the plugins make reaches the field. Its
    // undo covers the field only: accepting or rejecting a suggestion writes
    // into the shared text, not the fork, and is not undone with the edits.
    const binding = bindField(editor, options.shared, {
      origin: options.origin,
      renderer: options.renderer
    })
    if (options.awareness) {
      // Released with the binding: nothing of the editor is shared after
      const stopCursor = withSharedCursor(editor, options.awareness, options.cursor, options.isActive)
      const { release } = binding
      binding.release = () => {
        stopCursor()
        release()
      }
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
