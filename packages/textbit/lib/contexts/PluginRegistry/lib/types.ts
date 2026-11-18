import type { KeyboardEventLike } from 'is-hotkey'
import type { Action, ChildElementSpec, ComponentView, Plugin, ToolComponent } from '../../../types'

/**
 * @type
 * An element type the editor knows: its spec from the plugin's definition,
 * and, in an editor with a user interface, the view that renders it.
 *
 * `spec` and `parent` are typed as `ChildElementSpec`, the wider of the two
 * spec types, so this can hold both a plugin's own element and its children.
 * A top-level spec fits because its `min`/`max` are typed `never`.
 */
export type PluginRegistryComponent = {
  type: string
  class: string
  spec: ChildElementSpec
  view?: ComponentView
  parent: ChildElementSpec | null
  pluginOptions: Record<string, unknown>
}

/**
 * @type
 * Hotkey registry
 */
export type PluginRegistryAction = Action & {
  plugin: Plugin
  isHotkey: (action: KeyboardEventLike) => boolean
  /** The tool the plugin's view shows for it */
  tool?: ToolComponent | [ToolComponent, ToolComponent]
}

/**
 * @type
 * Plugin registry reducer action to add, or delete plugins
 */
export type PluginRegistryReducerAction = {
  action: 'add' | 'delete'
  plugin: Plugin
}


/**
 * @interface
 * Plugin registry provider state
 */
export interface PluginRegistryProviderState {
  // Main plugin registry
  plugins: Array<Plugin>

  // Component registries provide faster access in rendering cycles
  components: Map<string, PluginRegistryComponent>

  // Hotkey registry provides faster access to plugin actions
  actions: Array<PluginRegistryAction>

  verbose: boolean
  dispatch: React.Dispatch<PluginRegistryReducerAction>
}
