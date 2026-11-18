import type { Plugin } from '../../../types'
import type { PluginRegistryAction, PluginRegistryComponent } from './types'
import { registerPlugin } from './registerPlugin'
import { registerActions } from './registerAction'
import { registerComponents } from './registerComponents'
import { TextbitPlugin } from '../../../utils/textbit-plugin'

export interface Registry {
  plugins: Plugin[]
  actions: PluginRegistryAction[]
  components: Map<string, PluginRegistryComponent>
}

/** The plugins, actions and components of a set of plugins, in registration order */
export function createRegistry(plugins: Plugin[], options?: { verbose: boolean }): Registry {
  const empty: Registry = { plugins: [], actions: [], components: new Map() }
  return plugins.reduce<Registry>((registry, plugin) => addToRegistry(registry, plugin, options), empty)
}

/** The registry with one more plugin, which replaces any of the same name */
export function addToRegistry(registry: Registry, plugin: Plugin, options?: { verbose: boolean }): Registry {
  warnOfOldShape(plugin)
  const plugins = registerPlugin(registry.plugins, plugin, options)

  return {
    plugins,
    actions: registerActions(plugins),
    components: TextbitPlugin.isElementPlugin(plugin) && plugin.element
      ? registerComponents(
        registry.components,
        plugin.element.type || plugin.name,
        { ...plugin.element, type: plugin.element.type || plugin.name },
        options,
        plugin.options,
        plugin.view
      )
      : registry.components
  }
}

/**
 * TypeScript does not flag the 2.x fields when a plugin is built by a function,
 * and they would be ignored without a word. They are named here instead.
 */
function warnOfOldShape(plugin: Plugin): void {
  const old = plugin as Plugin & { componentEntry?: unknown, events?: unknown }
  if (old.componentEntry) {
    console.warn(`Plugin ${plugin.name}: componentEntry is gone in textbit 3, see element and view`)
  }
  if (old.events) {
    console.warn(`Plugin ${plugin.name}: events is gone in textbit 3`)
  }
  if (plugin.actions?.some((action) => 'tool' in action)) {
    console.warn(`Plugin ${plugin.name}: an action's tool belongs in view.tools in textbit 3`)
  }
}
