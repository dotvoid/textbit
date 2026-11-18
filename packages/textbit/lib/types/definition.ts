import type { Editor, Element, NodeEntry } from 'slate'

/*
 * What a plugin is without a user interface: its elements, rules and actions.
 * Nothing here may need React or a browser to load, so a plugin's definition
 * runs on a server as well. What it looks like is its view, see ./textbit.ts.
 */

/**
 * @type Options
 * Generic options object for the plugin, can be extended by specific plugins.
 */
export type Options<T extends Record<string, unknown> = Record<string, unknown>> = T

/** What an element is: text, an object, an inline element or a void */
export type ElementClass = 'text' | 'block' | 'void' | 'inline'

/** The event that set off an action, when there was one */
export interface ActionEvent {
  preventDefault(): void
  stopPropagation(): void
}

export interface ActionHandlerArgs {
  editor: Editor
  type: string
  options?: Options
  args?: Record<string, unknown>
  event?: ActionEvent
  /**
   * Hand files to the plugins that consume them, as a drop does: e.g. what a
   * person picked in a file dialog an action opened. Given wherever the
   * editor runs an action: menus, the toolbar and shortcuts.
   */
  consumeFiles?: (files: File[]) => void
}

/**
 * Action handler function that can handle keyboard events, mouse events, or generic actions.
 *
 * @param options - The action handler options
 * @returns `true` to indicate the textbit default action is accepted
 */
export type ActionHandler = (args: ActionHandlerArgs) => boolean | void

/**
 * @interface
 * An action: something a plugin does, by shortcut, menu or tool. Its tool, the
 * icon or control shown for it, is part of the plugin's view.
 */
export interface Action {
  name: string
  title?: string
  description?: string
  hotkey?: string
  handler: ActionHandler
  visibility?: (element: Element, rootElement?: Element) => [boolean, boolean, boolean] // visible, enabled, active
  /**
   * When given, the action only takes its hotkey while this returns true.
   * Otherwise the key goes on to the next action with the same hotkey, so
   * several plugins can share a key like Tab or Enter, each in its own context.
   */
  when?: (editor: Editor) => boolean
}

/**
 * Constraints shared by any element, top-level or a child in a parent's
 * `children` array.
 */
interface BaseConstraints {
  /** If true, prevents <enter> from having any effect, default is true */
  allowBreak?: boolean

  /** If true, prevents soft breaks (i.e breaks within one text element, default is true */
  allowSoftBreak?: boolean

  /** If false, prevents <enter> from exiting the top-level block when at the last position, default is true */
  allowExitBreak?: boolean

  /** If false, prevents whitespace at the start and end of a paragraph, default is true */
  allowEdgeWhitespace?: boolean

  /** Normalizer function, optional */
  normalizeNode?: (editor: Editor, nodeEntry: NodeEntry) => boolean | void
}

/**
 * Constraints valid on a plugin's own element. Cardinality (`min`/`max`) is
 * typed `never`: it only means something for a child in a parent.
 */
export interface TopLevelConstraints extends BaseConstraints {
  min?: never
  max?: never
}

/**
 * Constraints valid on a child element (an item in a parent's `children`
 * array). Adds the cardinality constraints `min` and `max`.
 */
export interface ChildConstraints extends BaseConstraints {
  /**
   * Minimum number of instances of this child type allowed within the parent.
   * If the count ever falls below `min`, the normalizer inserts a minimal
   * placeholder to restore the invariant. Use `min: 1, max: 1` to model a
   * permanent form-field-like child that always exists and cannot be removed.
   */
  min?: number

  /**
   * Maximum number of instances of this child type allowed within the parent.
   * Excess siblings are removed by the normalizer; Enter is blocked when the
   * count is already at `max`.
   */
  max?: number
}

/** A property an element stores in `properties` */
export interface PropertySchema {
  type: 'string' | 'number' | 'boolean'
  /** What it holds, for people and models reading the schema */
  description?: string
  /** Whether every element of the type must have it */
  required?: boolean
  /** The values it may take */
  enum?: (string | number)[]
}

/**
 * What an element means and what it may hold, beyond its structure. All
 * optional: a schema describes, it does not change how the editor behaves.
 * `getSchema` and `validate` read it, and so can agents.
 */
export interface ElementSchema {
  /** What the element is for */
  description?: string
  /** The properties it stores. Others are reported by `validate`. */
  properties?: Record<string, PropertySchema>
  /** Marks (leaf plugin names) its text may carry. Default: all. */
  marks?: string[] | 'all' | 'none'
  /** Inline element types its text may hold. Default: all. */
  inlines?: string[] | 'all' | 'none'
}

/** Fields common to a plugin's own element and its children */
interface BaseElementSpec {
  /** What the element is, see ElementClass */
  class: ElementClass

  /** Whether this element accepts drops, only applicable to top-level elements */
  droppable?: boolean

  /** Hint shown in an empty text element */
  placeholder?: string | ((element: Element) => string)

  /** The element's children, each with its own type */
  children?: ChildElementSpec[]

  /** What the element means and may hold */
  schema?: ElementSchema
}

/**
 * @type
 * A plugin's own element. Its type is the plugin's name, unless `type` gives
 * another.
 */
export interface ElementSpec extends BaseElementSpec {
  type?: string
  constraints?: TopLevelConstraints
}

/**
 * @type
 * A child element. Its full type is its parent's followed by its own, e.g.
 * `base/image/caption` for `caption` in `base/image`.
 */
export interface ChildElementSpec extends BaseElementSpec {
  type: string
  constraints?: ChildConstraints
}

/**
 * @interface
 * Base input to both consume and consumes functions
 */
export interface Resource {
  /** Source/name of data as text */
  source: string

  /** Mime type of indata, e.g text/uri-list, text/plain  */
  type: string

  /** Indata to consumer, e.g a File, text, url, etc */
  data: unknown
}

/**
 * @type ConsumesFunction
 * Definition of a function that should answer whether the plugin wants to handle input data.
 * Returns an array with one, two or three values.
 * 1: Boolean: whether it consumes data or not
 * 2: string | null: Definition of what consumer function will produce (e.g base/image),
 *  undefined if first value is false, can be null if nothing is produced.
 * 3. Boolean: whether it wants to consume data in bulk (true) or individually (default).
 *
 * @returns Array [boolean, string | null, ?boolean]
 */
export type ConsumesFunction = ({ input }: { input: Resource }) => [boolean, (string | null)?, boolean?]

/**
 * @type ConsumeFunction
 * Consume function definition. An async function which receives and consumes the data,
 * either individually or in bulk depending on what the the consumes function responded.
 *
 * Should return data as specified by the second value of the consumes function response.
 */
export type ConsumeFunction = ({ editor, input }: { editor: Editor, input: Resource | Resource[] }) => Promise<Resource | undefined>

/** CSS declarations, in the camelCase form of the style attribute */
export type LeafStyle = Record<string, string | number>

/**
 * @type GetLeafStyle
 * The style of a leaf: declarations, or a class name
 */
export type GetLeafStyle = () => LeafStyle | string

interface BaseDefinition {
  /**
   * Class of the plugin, inherited by its element. 'leaf' is a mark on text,
   * 'generic' a plugin without an element of its own.
   */
  class: 'leaf' | 'generic' | ElementClass

  /** Name of plugin, should be in the form of <prefix>/<plugin> */
  name: string

  /** What the plugin adds, for people and models reading the schema */
  description?: string

  /** What the plugin does, by shortcut, menu or tool */
  actions?: Action[]

  /** Options object */
  options?: Options

  /** The plugin's element and its children */
  element?: ElementSpec
}

/**
 * @interface
 * A plugin with elements of its own
 */
export interface ElementDefinition extends BaseDefinition {
  /**
   * Optional consumer definition. One for each consumes() and consume() functions.
   */
  consumer?: {
    consumes: ConsumesFunction // Can you consume [data], [true/false, provides `type` as response]
    consume: ConsumeFunction // Consume [data] please
  }
}

/**
 * @interface
 * A plugin marking text, such as bold
 */
export interface LeafDefinition extends BaseDefinition {
  /** Styling object or class name string for leaf components */
  getStyle: GetLeafStyle
}

/**
 * @interface
 * A plugin without a user interface. Add a view to render it.
 */
export type PluginDefinition =
  | ElementDefinition
  | LeafDefinition
