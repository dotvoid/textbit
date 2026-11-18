import { consumeFilesFor } from '../utils/consumeFiles'
import { useSlateStatic } from 'slate-react'
import { usePluginRegistry } from './usePluginRegistry'

/**
 * A plugin's action, to run from your own button or code, with arguments its
 * handler reads as `args`. Undefined when no such action is registered.
 *
 * ```tsx
 * const insertImage = useAction('base/image', 'insert')
 * <button onClick={() => insertImage?.()}>Image</button>
 * ```
 */
export function useAction(pluginName: string, actionName: string): ((args?: Record<string, unknown>) => void) | undefined {
  const editor = useSlateStatic()
  const { actions } = usePluginRegistry()

  const name = `${pluginName}/${actionName}`
  const action = actions.find((a) => a.name === name)

  if (!action) {
    return
  }

  return (args) => {
    action.handler({
      editor,
      consumeFiles: consumeFilesFor(editor),
      type: pluginName,
      options: action.plugin.options,
      args
    })
  }
}
