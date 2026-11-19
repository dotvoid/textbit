// How a textbit text field is kept in a Y.js 14 document.
//
// A text field is a Y.js node whose children are its blocks. An element is a
// nameless node: its type, id and class are attributes, and each of its
// properties is an attribute of its own (`p:<name>`), so two people changing
// different properties at once do not overwrite each other. The type being an
// attribute, changing it keeps the element, and what is anchored in it. Text is
// formatted text, marks are formats, inline elements are child nodes; elements
// holding elements hold them as child nodes. Documents written by textbit 2
// (Y.js 13, slate-yjs) have the same shape with all properties in one
// `properties` attribute, and are read as they are.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { Element, Text, type Descendant } from 'slate'

type Marks = Record<string, unknown>
type Fields = Record<string, unknown>

/** Marks starting with `_` are shown in the editor, never stored */
export const SHOWN_ONLY = '_'

/** How a suggested piece of text is shown: `_suggested` is `'insert'` or `'delete'` */
export const SUGGESTED_MARK = '_suggested'

/**
 * Who wrote, or deleted, a piece of text shown through a renderer with
 * attributions, by the key the attributions name them with
 */
export const BY_MARK = '_by'

/** When that was, in milliseconds */
export const AT_MARK = '_at'

const PROPERTY = 'p:'

/** What reads a field through Y.js 14's renderers, such as the suggestions view */
export type TBRenderer = NonNullable<Parameters<Y.Node['applyDelta']>[2]>['renderer']

export function isInline(node: Descendant): boolean {
  return Element.isElement(node) && node.class === 'inline'
}

/** Whether an element holds text and inline elements, rather than elements */
export function holdsText(element: { children: Descendant[] }): boolean {
  return element.children.every((child) => Text.isText(child) || isInline(child))
}

/** The length of a Slate child in Y.js: its characters, or one for an element */
export function yLength(node: Descendant): number {
  return Text.isText(node) ? node.text.length : 1
}

/** The Y.js offset of a child, by its index among the Slate children */
export function yOffset(parent: { children: Descendant[] }, index: number): number {
  let offset = 0
  for (let i = 0; i < index; i++) {
    offset += yLength(parent.children[i])
  }
  return offset
}

/** A text's marks as Y.js formats: what is shown only is left out */
export function marksOf(text: Text): Marks | undefined {
  const marks: Marks = {}
  for (const [key, value] of Object.entries(text)) {
    if (key !== 'text' && !key.startsWith(SHOWN_ONLY) && value !== undefined) {
      marks[key] = value
    }
  }
  return Object.keys(marks).length ? marks : undefined
}

/** An element's attributes in Y.js */
export function attrsOf(element: Fields): Fields {
  const attrs: Fields = {}
  for (const [key, value] of Object.entries(element)) {
    if (key === 'children' || value === undefined) {
      continue
    }
    if (key === 'properties' && isRecord(value)) {
      for (const [name, property] of Object.entries(value)) {
        if (property !== undefined) {
          attrs[PROPERTY + name] = property
        }
      }
      continue
    }
    attrs[key] = value
  }
  return attrs
}

/** Appends Slate nodes to a delta as inserts, with their formats */
export function withChildren(d: delta.DeltaBuilderAny, nodes: Descendant[]): delta.DeltaBuilderAny {
  let next = d
  for (const node of nodes) {
    if (Text.isText(node)) {
      if (node.text) {
        next = next.insert(node.text, marksOf(node) ?? null)
      }
    } else {
      next = next.insert([elementDelta(node)])
    }
  }
  return next
}

/** A Slate element as a delta that creates its Y.js node */
export function elementDelta(element: Element): delta.DeltaAny {
  const d: delta.DeltaBuilderAny = delta.create(null, attrsOf(element as unknown as Fields))
  return withChildren(d, element.children).done()
}

/** A Y.js element node as a Slate element */
export function toSlateElement(node: Y.Node, renderer?: TBRenderer): Element {
  const element: Fields = {}
  const properties: Fields = {}
  for (const [key, value] of Object.entries(node.getAttrs() as Fields)) {
    if (key.startsWith(PROPERTY)) {
      properties[key.slice(PROPERTY.length)] = value
    } else if (key === 'properties' && isRecord(value)) {
      Object.assign(properties, value) // written by textbit 2
    } else {
      element[key] = value
    }
  }
  if (node.name !== null && element.type === undefined) {
    element.type = node.name
  }
  if (Object.keys(properties).length) {
    element.properties = properties
  }
  return { ...element, children: toSlateChildren(node, renderer) } as unknown as Element
}

// Who wrote, or deleted, a piece and when, as marks shown only
function whoAndWhen(attribution: Fields | null | undefined): Marks {
  if (!attribution) {
    return {}
  }
  const deleted = Array.isArray(attribution.delete)
  const by = (deleted ? attribution.delete : attribution.insert) as unknown[] | undefined
  const at = deleted ? attribution.deleteAt : attribution.insertAt
  return {
    ...(typeof by?.[0] === 'string' ? { [BY_MARK]: by[0] } : {}),
    ...(typeof at === 'number' ? { [AT_MARK]: at } : {})
  }
}

/** A Y.js node's children as Slate children, in the form Slate normalizes to */
export function toSlateChildren(node: Y.Node, renderer?: TBRenderer): Descendant[] {
  const runs: Descendant[] = []
  for (const op of node.toDelta(renderer ? { renderer } : undefined).children) {
    const insert = (op as { insert?: unknown }).insert
    if (typeof insert === 'string') {
      const format = (op as { format?: Marks | null }).format ?? {}
      const attribution = (op as { attribution?: Fields | null }).attribution
      const suggested = attribution?.delete ? 'delete' : attribution?.insert ? 'insert' : undefined
      runs.push({ ...format, ...(suggested ? { [SUGGESTED_MARK]: suggested } : {}), ...whoAndWhen(attribution), text: insert } as Text)
    } else if (Array.isArray(insert)) {
      for (const child of insert) {
        if (child instanceof Y.Node) {
          runs.push(toSlateElement(child, renderer))
        }
      }
    }
  }
  if (runs.length && runs.every((run) => Element.isElement(run) && !isInline(run))) {
    return runs
  }
  // Text, with inline elements between texts, as Slate wants them
  const children: Descendant[] = []
  for (const run of runs) {
    const last = children[children.length - 1]
    if (isInline(run)) {
      if (!last || !Text.isText(last)) {
        children.push({ text: '' })
      }
      children.push(run)
    } else if (last && Text.isText(last) && Text.isText(run) && sameLeaf(last, run)) {
      children[children.length - 1] = { ...last, text: last.text + run.text }
    } else {
      children.push(run)
    }
  }
  const last = children[children.length - 1]
  if (!last || !Text.isText(last)) {
    children.push({ text: '' })
  }
  return children
}

/**
 * A text field's blocks, as a value for an editor or for storing as JSON.
 *
 * @param renderer Reads through a Y.js 14 renderer, such as the suggestions
 * view, which shows suggested text with the `_suggested` mark
 */
export function fieldToValue(field: Y.Node, renderer?: TBRenderer): Element[] {
  return toSlateChildren(field, renderer).filter((node) => Element.isElement(node))
}

/**
 * Fills a new, empty text field with a value, in one change. A field is filled
 * once, where it is created; to change a field later, edit it through an editor.
 */
export function seedField(field: Y.Node, value: Descendant[], origin?: unknown): void {
  if (field.length) {
    throw new Error('seedField fills an empty text field; this one has content')
  }
  const fill = () => field.applyDelta(withChildren(delta.create(), value).done())
  if (field.doc) {
    field.doc.transact(fill, origin)
  } else {
    fill()
  }
}

/** The blocks of an editor: Slate keeps an empty text at the top when there are none */
export function blocksOf(children: Descendant[]): Descendant[] {
  return children.filter((node) => Element.isElement(node))
}

/** Whether two texts look the same: their marks and what is shown with them */
export function sameLeaf(a: Text, b: Text): boolean {
  return canonical({ ...a, text: '' }) === canonical({ ...b, text: '' })
}

/**
 * A value in the form both sides can hold, to compare an editor with Y.js.
 * Marks on an empty text are the editor's (the next character typed takes
 * them): Y.js has no character to keep them on. An empty `properties` is no
 * properties: Y.js keeps each property as an attribute, so none are left.
 */
export function comparable(children: Descendant[]): string {
  return canonical(children, (value) => {
    if (Text.isText(value) && value.text === '') {
      return { text: '' }
    }
    if (isRecord(value) && isRecord(value.properties) && Object.keys(value.properties).length === 0) {
      const rest: Record<string, unknown> = { ...value }
      delete rest.properties
      return rest
    }
    return value
  })
}

/** JSON with sorted keys, for comparing values */
export function canonical(value: unknown, map: (value: unknown) => unknown = (v) => v): string {
  return JSON.stringify(value, (_key, original: unknown) => {
    const v = map(original)
    if (isRecord(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    }
    return v
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
