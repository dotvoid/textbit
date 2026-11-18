import type { ChildElementSpec, ComponentView } from '../../types'
import { PlainContent } from './PlainContent'
import type { PluginRegistryComponent } from '../../contexts/PluginRegistry/lib/types'

/** What the element renderers need: the element's spec and its view */
export type RenderEntry = ChildElementSpec & ComponentView

/**
 * The spec and view of a known element type. An element whose plugin has no
 * view renders its children as they are, in the wrapper every element gets.
 */
export function renderEntry(component: PluginRegistryComponent): RenderEntry {
  return { ...component.spec, ...(component.view ?? PLAIN_VIEW) }
}

const PLAIN_VIEW: ComponentView = {
  component: PlainContent
}
