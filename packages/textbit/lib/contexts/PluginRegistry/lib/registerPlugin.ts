import type { PluginDefinition } from '../../../types'

/**
 * Register a plugin, always replaces plugins with same name.
 *
 * Replacement is a contract, not an accident: the last plugin
 * registered under a name wins and takes the earlier one's position.
 * Consumers rely on it to swap a base plugin (`core/text`) for their
 * own, so it is reported only in verbose mode.
 *
 * @param registryPlugins PluginDefinition[]
 * @param plugin PluginDefinition[]
 * @returns PluginDefinition[]
 */
export function registerPlugin(registryPlugins: PluginDefinition[], plugin: PluginDefinition, options?: { verbose: boolean }) {
  if (options?.verbose) {
    console.info(`Registering plugin ${plugin.name}`)
  }

  const plugins = [...registryPlugins]
  const idx = plugins.findIndex((existingPlugin) => existingPlugin.name === plugin.name)
  if (idx !== -1) {
    if (options?.verbose) {
      console.info(`Overriding already registered plugin ${plugin.name}`)
    }
    plugins[idx] = plugin
  } else {
    plugins.push(plugin)
  }

  return plugins
}
