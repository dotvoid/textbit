import type { KeyboardEventLike } from 'is-hotkey'
import type { Action, ChildElementSpec, ComponentView, Plugin, ToolComponent } from '../../../types'

/**
 * An element type the editor knows: its spec from the plugin's definition,
 * and, in an editor with a user interface, the view that renders it.
 *
 * `spec` and `parent` are typed as `ChildElementSpec`, the wider of the two
 * spec types, so this can hold both a plugin's own element and its children.
 * A top-level spec fits because its `min`/`max` are typed `never`.
 */
export type PluginRegistryComponent = {
  /** Its full type */
  type: string
  /** Its class */
  class: string
  /** Its spec, from the plugin's definition */
  spec: ChildElementSpec
  /** Its view, from the plugin's */
  view?: ComponentView
  /** The spec of the element it is a child of */
  parent: ChildElementSpec | null
  /** The plugin's options */
  pluginOptions: Record<string, unknown>
}

/**
 * An action as the registry holds it: the plugin's action, named
 * `<plugin>/<action>` (e.g. `base/bold/toggle-bold`), with its plugin and tool
 */
export type PluginRegistryAction = Action & {
  /** The plugin the action is of */
  plugin: Plugin
  /** Whether a key event is the action's shortcut */
  isHotkey: (action: KeyboardEventLike) => boolean
  /** The tool the plugin's view shows for it */
  tool?: ToolComponent | [ToolComponent, ToolComponent]
}

/** @internal Adds or removes a plugin */
export type PluginRegistryReducerAction = {
  action: 'add' | 'delete'
  plugin: Plugin
}


/** What `usePluginRegistry()` gives: the plugins the editor runs, and what they bring */
export interface PluginRegistryProviderState {
  /** The plugins, in the order registered: core's own first */
  plugins: Array<Plugin>
  /** Every element type the plugins bring, by full type */
  components: Map<string, PluginRegistryComponent>
  /** Every action the plugins bring, with its shortcut and tool */
  actions: Array<PluginRegistryAction>
  /** Whether the registry logs what it registers, as `verbose` on `Textbit.Root` */
  verbose: boolean
  /** @internal */
  dispatch: React.Dispatch<PluginRegistryReducerAction>
}
