import type { Editor, Element, NodeEntry } from 'slate'

/*
 * What a plugin is without a user interface: its elements, rules and actions.
 * Nothing here may need React or a browser to load, so a plugin's definition
 * runs on a server as well. What it looks like is its view, see ./textbit.ts.
 */

/**
 * A plugin's options: whatever it takes, as an object. Components in its view
 * get them as `options`.
 */
export type Options<T extends Record<string, unknown> = Record<string, unknown>> = T

/** What an element is: text, an object, an inline element or a void */
export type ElementClass = 'text' | 'block' | 'void' | 'inline'

/** The event that set off an action, when there was one: a key or a click */
export interface ActionEvent {
  /** Keep the browser from doing what it would with the event */
  preventDefault(): void
  /** Keep the event from reaching other handlers */
  stopPropagation(): void
}

/** What an action's handler gets */
export interface ActionHandlerArgs {
  /** The editor the action runs in */
  editor: Editor
  /** The name of the action's plugin, e.g. `base/image` */
  type: string
  /** The plugin's options */
  options?: Options
  /** What the caller passed, as with `useAction(plugin, action)(args)` */
  args?: Record<string, unknown>
  /** The key or click that set the action off; none when code ran it */
  event?: ActionEvent
  /**
   * Hand files to the plugins that consume them, as a drop does: e.g. what a
   * person picked in a file dialog an action opened. Given wherever the
   * editor runs an action: menus, the toolbar and shortcuts.
   */
  consumeFiles?: (files: File[]) => void
}

/**
 * What an action does. Return `true` to let the editor also do its default
 * for the plugin's class, when there is one: toggle the mark of a leaf plugin
 * (as Bold's handler does), or turn the selected blocks into the plugin's
 * type for a text plugin. Return nothing when the handler did everything; a
 * shortcut then goes no further.
 */
export type ActionHandler = (args: ActionHandlerArgs) => boolean | void

/**
 * Something a plugin does, by shortcut, menu or tool. Its tool, the icon or
 * control shown for it, is part of the plugin's view.
 *
 * ```ts
 * {
 *   name: 'toggle-bold',
 *   title: 'Bold',
 *   hotkey: 'mod+b',
 *   handler: () => true
 * }
 * ```
 */
export interface Action {
  /** Unique in its plugin; the registry names it `<plugin>/<name>`, e.g. `base/bold/toggle-bold` */
  name: string
  /** Shown in menus and to screen readers, e.g. `Bold` */
  title?: string
  /** A longer explanation, e.g. for a tooltip */
  description?: string
  /** A shortcut, in is-hotkey's notation: `mod+b`, `mod+shift+8`, `tab` */
  hotkey?: string
  /** What the action does */
  handler: ActionHandler
  /**
   * Whether menus show the action, enable it and mark it active, as
   * `[visible, enabled, active]`, given the outermost element at the selection
   * and the innermost, where the caret is. Without it, menus do not show the
   * action; its shortcut works either way.
   */
  visibility?: (element: Element, rootElement?: Element) => [boolean, boolean, boolean]
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
  /** Whether Enter breaks the element in two. `false` makes it a single line. Default: `true`. */
  allowBreak?: boolean

  /**
   * Whether Shift+Enter adds a line break within the text. Soft breaks are
   * opt-in: allowed where the element or one around it sets this to `true`,
   * and none sets it to `false`. Default: not set.
   */
  allowSoftBreak?: boolean

  /** Whether Enter at the very end leaves the block for a new paragraph after it. Default: `true`. */
  allowExitBreak?: boolean

  /** Whether text may start or end with whitespace; trailing whitespace is trimmed on blur when not. Default: `true`. */
  allowEdgeWhitespace?: boolean

  /**
   * Repairs of the plugin's own, after the editor's: given an element of this
   * type, fix what is wrong with Slate transforms and return `true`; return
   * nothing when it is fine.
   */
  normalizeNode?: (editor: Editor, nodeEntry: NodeEntry) => boolean | void
}

/**
 * Constraints valid on a plugin's own element. Cardinality (`min`/`max`) is
 * typed `never`: it only means something for a child in a parent.
 */
export interface TopLevelConstraints extends BaseConstraints {
  /** Only for children: see {@link ChildConstraints} */
  min?: never
  /** Only for children: see {@link ChildConstraints} */
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
  /** The kind of value */
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
 * A plugin's own element. Its type is the plugin's name, unless `type` gives
 * another.
 *
 * ```ts
 * element: {
 *   class: 'block',
 *   children: [
 *     { type: 'content', class: 'void', constraints: { min: 1, max: 1 } },
 *     { type: 'caption', class: 'text', constraints: { min: 1, max: 1, allowBreak: false } }
 *   ]
 * }
 * ```
 */
export interface ElementSpec extends BaseElementSpec {
  /** The element's type, when it is not the plugin's name */
  type?: string
  /** Editing rules for the element */
  constraints?: TopLevelConstraints
}

/**
 * A child element. Its full type is its parent's followed by its own, e.g.
 * `base/image/caption` for `caption` in `base/image`.
 */
export interface ChildElementSpec extends BaseElementSpec {
  /** Its own part of the type, e.g. `caption` */
  type: string
  /** Editing rules, including how many of it the parent holds */
  constraints?: ChildConstraints
}

/** Something dropped, pasted or picked, as consumers get it */
export interface Resource {
  /** Where it came from, e.g. `drop`, `paste` or `fileinput` */
  source: string

  /** Its MIME type, e.g. `image/png` or `text/uri-list` */
  type: string

  /** The data: a `File`, a string, or for a consumer's result the element to insert */
  data: unknown
}

/**
 * Whether a plugin takes a resource, asked for each dropped, pasted or picked
 * item. Returns `[takes, produces, together]`:
 *
 * 1. whether the plugin takes it;
 * 2. the type it makes of it, e.g. `base/image`, or null when it makes nothing;
 * 3. `true` to get all such items in one call, rather than one call each.
 *
 * ```ts
 * consumes: ({ input }) => [input.data instanceof File && input.type.startsWith('image/'), 'base/image']
 * ```
 */
export type ConsumesFunction = ({ input }: { input: Resource }) => [boolean, (string | null)?, boolean?]

/**
 * Takes what `consumes` said yes to, one item or all of them, and returns the
 * element to insert, as `{ type, data }` with `type` the one `consumes` named
 * and `data` the element. Return undefined to insert nothing, e.g. when the
 * person cancelled an upload. While it runs, the editor shows an upload marker
 * where the result will go.
 */
export type ConsumeFunction = ({ editor, input }: { editor: Editor, input: Resource | Resource[] }) => Promise<Resource | undefined>

/** CSS declarations, in the camelCase form of the style attribute */
export type LeafStyle = Record<string, string | number>

/**
 * The style of a mark: CSS declarations, or a class name to style it from a
 * stylesheet. `() => ({ fontWeight: 'bold' })`, `() => 'tb-code'`.
 */
export type GetLeafStyle = () => LeafStyle | string

interface BaseDefinition {
  /**
   * Class of the plugin, inherited by its element. 'leaf' is a mark on text,
   * 'generic' a plugin without an element of its own.
   */
  class: 'leaf' | 'generic' | ElementClass

  /**
   * The plugin's name, `<namespace>/<name>`: `base/image`, `acme/factbox`. It is
   * the type of its element in every stored document. A plugin with the name of
   * another replaces it.
   */
  name: string

  /** What the plugin adds, for people and models reading the schema */
  description?: string

  /** What the plugin does, by shortcut, menu or tool */
  actions?: Action[]

  /** The plugin's options, which components in its view get as `options` */
  options?: Options

  /** The plugin's element and its children */
  element?: ElementSpec
}

/** A plugin with an element of its own, or none (`generic`) */
export interface ElementDefinition extends BaseDefinition {
  /** Taking dropped, pasted and picked things, such as image files */
  consumer?: {
    /** Whether the plugin takes an item, and what it makes of it */
    consumes: ConsumesFunction
    /** Makes the element from what it took */
    consume: ConsumeFunction
  }
}

/** A plugin marking text, such as bold. Its name is the mark's key on text. */
export interface LeafDefinition extends BaseDefinition {
  /** How marked text looks */
  getStyle: GetLeafStyle
}

/**
 * A plugin without a user interface: its element, rules and actions. Nothing
 * in it needs React, so it runs on a server too. Add a view, see `TBPlugin`,
 * to render it.
 */
export type PluginDefinition =
  | ElementDefinition
  | LeafDefinition
