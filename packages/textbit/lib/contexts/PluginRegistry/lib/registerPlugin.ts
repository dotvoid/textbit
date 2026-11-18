import type { Plugin } from '../../../types'

/**
 * Register a plugin, always replaces plugins with same name.
 *
 * Replacement is a contract, not an accident: the last plugin
 * registered under a name wins and takes the earlier one's position.
 * It registers a plugin again with other options, and replaces core's
 * plain `base/text` with a text plugin that keeps its format, so it is
 * reported only in verbose mode. Plugins with their own document format
 * use their own namespace instead.
 *
 * @param registryPlugins Plugin[]
 * @param plugin Plugin[]
 * @returns Plugin[]
 */
export function registerPlugin(registryPlugins: Plugin[], plugin: Plugin, options?: { verbose: boolean }) {
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
