import type { Options, ChildElementSpec, PluginView } from '../../../types/textbit'
import type { PluginRegistryComponent } from './types'

/**
 * Register a plugin's element and its children recursively, each with the
 * view that renders it, when the plugin has one.
 *
 * `ChildElementSpec` is the parameter type because it is the wider of the two
 * spec types: a plugin's own `ElementSpec` fits it, and children are always
 * `ChildElementSpec`.
 */
export const registerComponents = (
  currentComponents: Map<string, PluginRegistryComponent>,
  componentType: string,
  spec: ChildElementSpec,
  options?: { verbose: boolean },
  pluginOptions?: Options,
  view?: PluginView
) => {
  const components: Map<string, PluginRegistryComponent> = new Map(currentComponents)

  registerComponent(components, componentType, spec, options || {}, pluginOptions || {}, view)
  return components
}


const registerComponent = (
  components: Map<string, PluginRegistryComponent>,
  componentType: string,
  spec: ChildElementSpec,
  options: {
    verbose?: boolean
    parent?: ChildElementSpec
  },
  pluginOptions: Record<string, unknown>,
  view?: PluginView
) => {
  if (components.has(componentType)) {
    if (options.verbose) {
      console.info(`%c Component ${componentType} render function overrided by new render component with the same type`)
    }
  }

  if (!spec.class) {
    // Every element must have a class
    console.warn(`Component ${componentType} is missing a class, using "text" as fallback type`)
  }

  components.set(componentType, {
    type: componentType,
    class: spec.class || 'text',
    spec,
    view: view?.components?.[componentType],
    parent: options?.parent || null,
    pluginOptions: pluginOptions || {}
  })

  const { children = [] } = spec
  children.forEach((child) => {
    if (!child.type) {
      throw (new Error(`Child component of ${componentType} is missing mandatory type`))
    }

    registerComponent(
      components,
      `${componentType}/${child.type}`, // Aggregated type identifier (e.g. base/image/caption)
      child,
      {
        verbose: options.verbose,
        parent: spec
      },
      pluginOptions,
      view
    )
  })
}
