import type { PluginDefinition } from '../types/definition'
import { basePlugins, StandardPlugins } from '../plugins'

/**
 * The plugins an editor has: core's own, then the given ones, or core's plain
 * text block when none are given. As Textbit.Root does.
 */
export function editorPlugins<T extends PluginDefinition>(plugins?: T[]): (T | PluginDefinition)[] {
  return [
    ...basePlugins.map((plugin) => plugin()),
    ...plugins?.length ? plugins : StandardPlugins.map((plugin) => plugin())
  ]
}
