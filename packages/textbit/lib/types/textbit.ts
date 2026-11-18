import type { PropsWithChildren, ReactNode } from 'react'
import type { RenderElementProps } from 'slate-react'
import type { NodeEntry, Node, Editor, Element } from 'slate'
import type { Options, PluginDefinition } from './definition'

export * from './definition'

/**
 * @type
 * Shape of `attributes` provided to plugin components that opt into
 * `asOwnElement`. Spreading these onto a DOM element of type `T` carries
 * slate-react's ref and `data-slate-node` along with the framework's
 * `data-id`, `data-type`, optional `data-role`, and `lang`.
 *
 * `data-role` is optional. It is emitted only when `properties.role` is a
 * non-empty string (e.g. `heading-1`, `preamble`). An absent `data-role`
 * means the element is regular text — it is never required.
 */
export type ElementAttributes<T extends HTMLElement = HTMLElement> = {
  'data-slate-node': 'element'
  'data-slate-inline'?: true
  'data-slate-void'?: true
  'data-id'?: string
  'data-type': string
  'data-role'?: string
  lang?: string
  dir?: 'rtl'
  ref: React.Ref<T>
}

/**
 * @interface
 * Textbit component props.
 *
 * Components that opt into `asOwnElement` receive `attributes` and must
 * spread them onto their root DOM node. Parameterize `T` with the root
 * element's HTML type (e.g. `HTMLTableRowElement`) so the ref carried in
 * `attributes` is correctly typed for that element.
 */
export interface ComponentProps<T extends HTMLElement = HTMLElement> extends Omit<RenderElementProps, 'attributes'> {
  rootNode?: Element
  options?: Options
  editor: Editor
  children: React.ReactNode
  attributes?: ElementAttributes<T>
}

/**
 * @interface
 * Textbit component for rendering a TBElement (Slate Element)
 */
export type Component<T extends HTMLElement = HTMLElement, Props = ComponentProps<T>> = {
  (props: Props): ReactNode
}

/**
 * @type
 * Props handed to a plugin component that opts into `asOwnElement: true`.
 * Identical to `ComponentProps<T>` except `attributes` is non-nullable —
 * the framework guarantees it when the component owns its root element.
 */
export type OwnElementComponentProps<T extends HTMLElement = HTMLElement> =
  Omit<ComponentProps<T>, 'attributes'> & {
    attributes: ElementAttributes<T>
  }

/**
 * @type
 * Component for a plugin entry that owns its root DOM element.
 */
export type OwnElementComponent<T extends HTMLElement = HTMLElement> = {
  (props: OwnElementComponentProps<T>): ReactNode
}

/**
 * @interface
 * Textbit tool component props
 */
export type ToolComponentProps = {
  editor: Editor
  entry?: NodeEntry<Node>
  active?: boolean
} & PropsWithChildren

/**
 * @type
 * ToolComponent for rendering a tool
 */
export type ToolComponent<Props = ToolComponentProps> = React.ComponentType<Props>


/**
 * How an element renders. Discriminated on `asOwnElement`:
 *
 * - When `asOwnElement` is omitted or `false`, the framework wraps the
 *   component in a `<div>` and the component receives `ComponentProps<T>`
 *   (where `attributes` is undefined).
 * - When `asOwnElement` is `true`, the component renders as the element
 *   itself and is required to spread `attributes` (now non-nullable) onto
 *   its root DOM node.
 */
export type ComponentView<T extends HTMLElement = HTMLElement> =
  | {
      asOwnElement?: false
      component: Component<T>
    }
  | {
      asOwnElement: true
      component: OwnElementComponent<T>
    }

/**
 * @interface
 * What a plugin looks like: the components rendering its elements, by full
 * type, and the tools shown for its actions, by action name.
 */
export interface PluginView {
  // Each component is typed for its own root element
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, ComponentView<any>>
  tools?: Record<string, ToolComponent | [ToolComponent, ToolComponent]>
}

/**
 * @type
 * A plugin as an editor with a user interface uses it: its definition and
 * its view. Without a view, its elements render as plain blocks.
 */
export type Plugin = PluginDefinition & {
  view?: PluginView
}

/**
 * @type PluginInitFunction
 * Plugin initialization function
 */
export type PluginInitFunction<O extends Options = Options> = (options?: O) => Plugin
