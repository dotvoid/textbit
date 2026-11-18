import type { PluginDefinition } from '../../../types'
import type { PluginRegistryAction, PluginRegistryComponent } from './types'
import { registerPlugin } from './registerPlugin'
import { registerActions } from './registerAction'
import { registerComponents } from './registerComponents'
import { TextbitPlugin } from '../../../utils/textbit-plugin'

export interface Registry {
  plugins: PluginDefinition[]
  actions: PluginRegistryAction[]
  components: Map<string, PluginRegistryComponent>
}

/** The plugins, actions and components of a set of plugins, in registration order */
export function createRegistry(plugins: PluginDefinition[], options?: { verbose: boolean }): Registry {
  const empty: Registry = { plugins: [], actions: [], components: new Map() }
  return plugins.reduce<Registry>((registry, plugin) => addToRegistry(registry, plugin, options), empty)
}

/** The registry with one more plugin, which replaces any of the same name */
export function addToRegistry(registry: Registry, plugin: PluginDefinition, options?: { verbose: boolean }): Registry {
  const plugins = registerPlugin(registry.plugins, plugin, options)

  return {
    plugins,
    actions: registerActions(plugins),
    components: TextbitPlugin.isElementPlugin(plugin) && plugin.componentEntry
      ? registerComponents(
        registry.components,
        plugin.componentEntry.type || plugin.name,
        plugin.componentEntry,
        options,
        plugin.options
      )
      : registry.components
  }
}
