import type { PropsWithChildren, ReactNode } from 'react'
import type { RenderElementProps } from 'slate-react'
import type { NodeEntry, Node, Editor, Element } from 'slate'
import type { Options, PluginDefinition } from './definition'

export * from './definition'

/**
 * What a component that renders its element itself (`asOwnElement`) spreads
 * on its root DOM node: Slate's ref and attributes, and textbit's `data-id`,
 * `data-type`, `data-role` and `lang`. Type `T` is the root's HTML type, e.g.
 * `HTMLTableRowElement`, so the ref fits it.
 *
 * ```tsx
 * component: ({ attributes, children }: TBOwnElementComponentProps<HTMLLIElement>) => (
 *   <li {...attributes}>{children}</li>
 * )
 * ```
 */
export type ElementAttributes<T extends HTMLElement = HTMLElement> = {
  /** Slate's marker of an element */
  'data-slate-node': 'element'
  /** Set on inline elements */
  'data-slate-inline'?: true
  /** Set on voids */
  'data-slate-void'?: true
  /** The element's id */
  'data-id'?: string
  /** The element's type */
  'data-type': string
  /** The element's `properties.role`, when it has one, e.g. `heading-1` */
  'data-role'?: string
  /** The element's language, when it has its own */
  lang?: string
  /** `rtl` for right-to-left text */
  dir?: 'rtl'
  /** Slate's ref to the root node */
  ref: React.Ref<T>
}

/**
 * What a component in a plugin's view gets.
 *
 * ```tsx
 * const Quote = ({ children }: TBComponentProps) => <blockquote>{children}</blockquote>
 * ```
 */
export interface ComponentProps<T extends HTMLElement = HTMLElement> extends Omit<RenderElementProps, 'attributes'> {
  /** The top-level element this one is in, for a child */
  rootNode?: Element
  /** The plugin's options */
  options?: Options
  /** The editor */
  editor: Editor
  /** The element's children, as Slate renders them: render them, or the text cannot be edited */
  children: React.ReactNode
  /** Given only to components that render their element themselves; see `TBOwnElementComponentProps` */
  attributes?: ElementAttributes<T>
}

/** A component in a plugin's view, rendering one element type */
export type Component<T extends HTMLElement = HTMLElement, Props = ComponentProps<T>> = {
  (props: Props): ReactNode
}

/**
 * What a component that renders its element itself (`asOwnElement: true`)
 * gets: as `TBComponentProps`, with `attributes` always there.
 */
export type OwnElementComponentProps<T extends HTMLElement = HTMLElement> =
  Omit<ComponentProps<T>, 'attributes'> & {
    /** Spread these on the root DOM node */
    attributes: ElementAttributes<T>
  }

/** A component that renders its element itself; see `TBComponentView` */
export type OwnElementComponent<T extends HTMLElement = HTMLElement> = {
  (props: OwnElementComponentProps<T>): ReactNode
}

/** What a tool, the icon or control shown for an action, gets */
export type ToolComponentProps = {
  /** The editor */
  editor: Editor
  /** In the toolbar: the plugin's inline element at the selection, or the text there */
  entry?: NodeEntry<Node>
  /** Whether the plugin's mark is on at the selection */
  active?: boolean
} & PropsWithChildren

/**
 * The icon or control shown for an action in menus and the toolbar. A pair,
 * `[icon, control]`, shows the control instead while the selection is in one
 * of the plugin's inline elements, as Link's address field does.
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
      /** Wrapped in a `<div>` the editor renders. Default. */
      asOwnElement?: false
      /** Renders the element's content */
      component: Component<T>
    }
  | {
      /** The component renders the element's own node, e.g. an `<li>` in a list */
      asOwnElement: true
      /** Renders the element, spreading `attributes` on its root */
      component: OwnElementComponent<T>
    }

/**
 * What a plugin looks like: the components rendering its elements, by full
 * type, and the tools shown for its actions, by action name.
 *
 * ```tsx
 * view: {
 *   components: {
 *     'acme/figure': { component: Figure },
 *     'acme/figure/caption': { asOwnElement: true, component: Caption }
 *   },
 *   tools: { insert: () => <FigureIcon /> }
 * }
 * ```
 */
export interface PluginView {
  /** By full type: the plugin's name, or `<name>/<child>` for its children */
  // Each component is typed for its own root element
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, ComponentView<any>>
  /** By action name, as in the definition's `actions` */
  tools?: Record<string, ToolComponent | [ToolComponent, ToolComponent]>
}

/**
 * A plugin as `Textbit.Root` takes it: its definition and its view. Without
 * a view, its elements render their children in the editor's plain wrapper.
 * Plugins of `@dotvoid/textbit-plugins` are these; their definitions alone
 * come from `@dotvoid/textbit-plugins/definitions`.
 */
export type Plugin = PluginDefinition & {
  /** How it looks: its components and tools */
  view?: PluginView
}

/**
 * A function making a plugin from its options. Kept for 2.x plugins: prefer
 * writing `(options?: MyOptions): TBPlugin => ({ … })`, which TypeScript checks
 * for fields that do not belong, where a typed variable does not.
 */
export type PluginInitFunction<O extends Options = Options> = (options?: O) => Plugin
