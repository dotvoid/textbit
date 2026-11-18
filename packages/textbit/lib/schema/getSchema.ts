import type {
  ChildConstraints,
  ElementClass,
  PluginDefinition,
  PropertySchema
} from '../types/definition'
import { createRegistry, type Registry } from '../contexts/PluginRegistry/lib/createRegistry'
import { editorPlugins } from '../editor/editorPlugins'
import { TextbitPlugin } from '../utils/textbit-plugin'

/**
 * What documents of an editor may hold: its element types, marks, and which
 * types may stand at the top level. Plain data, to serialize, show a model or
 * check a document against.
 */
export interface DocumentSchema {
  /** Element types, by full type */
  elements: Record<string, ElementTypeSchema>
  /** Marks, by leaf plugin name */
  marks: Record<string, { description?: string }>
  /** Element types that may stand at the top level */
  topLevel: string[]
}

export interface ElementTypeSchema {
  type: string
  class: ElementClass
  description?: string
  /** The type it belongs in, for a child type */
  parent?: string
  /** Its child types in the order they come, with how many of each */
  children?: { type: string, min?: number, max?: number }[]
  /** Its properties. Undefined when the plugin does not declare them. */
  properties?: Record<string, PropertySchema>
  /** Marks its text may carry */
  marks: string[]
  /** Inline element types its text may hold */
  inlines: string[]
  /** Hint shown when empty, when it is a fixed text */
  placeholder?: string
  /** Whether Enter may break it */
  allowBreak: boolean
  /** Whether Shift+Enter breaks a line in it */
  allowSoftBreak: boolean
}

/**
 * The schema of an editor with these plugins, core's own included, as
 * `createTextbitEditor` and `Textbit.Root` would have them.
 */
export function getSchema(plugins?: PluginDefinition[]): DocumentSchema {
  const registry = createRegistry(editorPlugins(plugins))
  const leafs = registry.plugins.filter(TextbitPlugin.isLeafPlugin)
  const allMarks = leafs.map((plugin) => plugin.name)
  const allInlines = [...registry.components.values()]
    .filter((component) => component.class === 'inline')
    .map((component) => component.type)

  const elements: Record<string, ElementTypeSchema> = {}
  const topLevel: string[] = []

  for (const component of registry.components.values()) {
    const { spec, type } = component
    const parentType = component.parent ? type.slice(0, type.lastIndexOf('/')) : undefined
    const constraints = (spec.constraints ?? {}) as ChildConstraints
    const schema = spec.schema

    elements[type] = {
      type,
      class: spec.class,
      ...(schema?.description ? { description: schema.description } : {}),
      ...(parentType ? { parent: parentType } : {}),
      ...(spec.children?.length
        ? {
          children: spec.children.map((child) => {
            const { min, max } = child.constraints ?? {}
            return {
              type: `${type}/${child.type}`,
              ...(min !== undefined ? { min } : {}),
              ...(max !== undefined ? { max } : {})
            }
          })
        }
        : {}),
      ...(schema?.properties ? { properties: schema.properties } : {}),
      marks: spec.class === 'text' || spec.class === 'inline' ? pick(schema?.marks, allMarks) : [],
      inlines: spec.class === 'text' ? pick(schema?.inlines, allInlines) : [],
      ...(typeof spec.placeholder === 'string' ? { placeholder: spec.placeholder } : {}),
      allowBreak: constraints.allowBreak ?? true,
      allowSoftBreak: softBreaks(registry.components, type)
    }

    if (!component.parent && spec.class !== 'inline') {
      topLevel.push(type)
    }
  }

  const marks = Object.fromEntries(leafs.map((plugin) => [
    plugin.name,
    plugin.description ? { description: plugin.description } : {}
  ]))

  return { elements, marks, topLevel }
}

/**
 * Whether Shift+Enter breaks text in an element: only when it or a parent opts
 * in, and none of them opts out, as the editor decides it
 */
function softBreaks(components: Registry['components'], type: string): boolean {
  let optIn = false
  for (let current: string | undefined = type; current; current = parentOf(components, current)) {
    const setting = components.get(current)?.spec.constraints?.allowSoftBreak
    if (setting === false) {
      return false
    }
    optIn ||= setting === true
  }
  return optIn
}

function parentOf(components: Registry['components'], type: string): string | undefined {
  return components.get(type)?.parent ? type.slice(0, type.lastIndexOf('/')) : undefined
}

function pick(choice: string[] | 'all' | 'none' | undefined, all: string[]): string[] {
  if (choice === 'none') {
    return []
  }
  return choice === undefined || choice === 'all' ? all : choice.filter((name) => all.includes(name))
}
