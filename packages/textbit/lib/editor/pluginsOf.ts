import type { Editor } from 'slate'
import type { PluginDefinition } from '../types/definition'

const PLUGINS = new WeakMap<Editor, PluginDefinition[]>()

/** Remember the plugins an editor was made with */
export function rememberPlugins(editor: Editor, plugins: PluginDefinition[]): void {
  PLUGINS.set(editor, plugins)
}

/** The plugins an editor was made with */
export function pluginsOf(editor: Editor): PluginDefinition[] {
  return PLUGINS.get(editor) ?? []
}
