// The mapping between a textbit text field (Slate elements) and Y.js 14 nodes.
//
// A text field is a Y.js node whose children are the field's blocks. An element
// is a nameless node: its type, id and class are attributes, and each property is
// an attribute of its own (`p:<name>`), so two people changing different
// properties at once do not overwrite each other. Text is formatted text, marks
// are formats, inline elements are child nodes. Elements holding elements (a
// list, a table) hold them as child nodes. Y.js 13 documents written by
// slate-yjs have the same shape, with all properties in one `properties`
// attribute, and are read as they are.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { Element, Text, type Descendant } from 'slate'
import './slate-types.ts'

export type Marks = Record<string, unknown>
export type SlateElement = Element & {
  id?: string
  type?: string
  class?: string
  properties?: Record<string, unknown>
  children: Descendant[]
}

const PROPERTY = 'p:'

export function isInline(node: Descendant): boolean {
  return Element.isElement(node) && (node as SlateElement).class === 'inline'
}

/** Whether an element holds text and inline elements, rather than elements */
export function holdsText(element: { children: Descendant[] }): boolean {
  return element.children.every((child) => Text.isText(child) || isInline(child))
}

/** The length of a Slate child in Y.js: its characters, or one for an element */
export function yLength(node: Descendant): number {
  return Text.isText(node) ? node.text.length : 1
}

/** The Y.js offset of a parent's child, by its index among the Slate children */
export function yOffset(parent: { children: Descendant[] }, index: number): number {
  let offset = 0
  for (let i = 0; i < index; i++) {
    offset += yLength(parent.children[i])
  }
  return offset
}

/** Marks starting with `_` are shown, never stored: suggestions, attribution */
export const SUGGESTED = '_suggested'

export function marksOf(text: Text): Marks | undefined {
  const marks: Marks = {}
  for (const [key, value] of Object.entries(text)) {
    if (key !== 'text' && !key.startsWith('_') && value !== undefined) {
      marks[key] = value
    }
  }
  return Object.keys(marks).length ? marks : undefined
}

/** An element's attributes in Y.js */
export function attrsOf(element: SlateElement): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
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

/** Slate children as the inserts of a delta */
export function childrenDelta(children: Descendant[]): delta.DeltaBuilderAny {
  let d: delta.DeltaBuilderAny = delta.create()
  for (const child of children) {
    if (Text.isText(child)) {
      if (child.text) {
        d = d.insert(child.text, marksOf(child) ?? null)
      }
    } else {
      d = d.insert([elementDelta(child as SlateElement)])
    }
  }
  return d
}

/** A Slate element as a delta that creates its Y.js node */
export function elementDelta(element: SlateElement): delta.DeltaAny {
  let d: delta.DeltaBuilderAny = delta.create(null, attrsOf(element))
  for (const child of element.children) {
    if (Text.isText(child)) {
      if (child.text) {
        d = d.insert(child.text, marksOf(child) ?? null)
      }
    } else {
      d = d.insert([elementDelta(child as SlateElement)])
    }
  }
  return d.done()
}

/** A Y.js element node as a Slate element */
export type Renderer = Parameters<Y.Node['toDelta']>[0] extends infer O
  ? O extends { renderer?: infer R } ? R : never
  : never

export function toSlateElement(node: Y.Node, renderer?: Renderer): SlateElement {
  const element: Record<string, unknown> = {}
  const properties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.getAttrs() as Record<string, unknown>)) {
    if (key.startsWith(PROPERTY)) {
      properties[key.slice(PROPERTY.length)] = value
    } else if (key === 'properties' && isRecord(value)) {
      Object.assign(properties, value) // Y.js 13, slate-yjs
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
  return { ...element, children: toSlateChildren(node, renderer) } as SlateElement
}

/** A Y.js node's children as Slate children, in the form Slate normalizes to */
export function toSlateChildren(node: Y.Node, renderer?: Renderer): Descendant[] {
  const runs: Descendant[] = []
  for (const op of node.toDelta(renderer ? { renderer } : undefined).children) {
    const insert = (op as { insert?: unknown }).insert
    if (typeof insert === 'string') {
      const format = (op as { format?: Marks | null }).format ?? {}
      const attribution = (op as { attribution?: Record<string, unknown> | null }).attribution
      const suggested = attribution?.delete ? 'delete' : attribution?.insert ? 'insert' : undefined
      runs.push({ ...format, ...(suggested ? { [SUGGESTED]: suggested } : {}), text: insert } as Text)
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
  // Text, with inline elements between empty texts, as Slate wants them
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

/** A text field's blocks */
export function toSlateValue(field: Y.Node, renderer?: Renderer): SlateElement[] {
  return toSlateChildren(field, renderer).filter((node) => Element.isElement(node)) as SlateElement[]
}

/** The blocks of an editor: Slate keeps an empty text at the top when there are none */
export function blocksOf(children: Descendant[]): Descendant[] {
  return children.filter((node) => Element.isElement(node))
}

/** Fills an empty text field with blocks, in one change */
export function seedField(field: Y.Node, blocks: SlateElement[], origin?: unknown) {
  const doc = field.doc
  const apply = () => field.applyDelta(childrenDelta(blocks).done())
  if (doc) {
    doc.transact(apply, origin)
  } else {
    apply()
  }
}

/** Whether two texts look the same: their marks, and what is shown with them */
export function sameLeaf(a: Text, b: Text): boolean {
  const { text: _a, ...restA } = a
  const { text: _b, ...restB } = b
  return canonical(restA) === canonical(restB)
}

export function sameMarks(a: Text, b: Text): boolean {
  return canonical(marksOf(a) ?? {}) === canonical(marksOf(b) ?? {})
}

/**
 * A value in the form both sides can hold, for comparing an editor with Y.js:
 * marks on an empty text are the editor's own (the next character typed takes
 * them), and Y.js has no character to keep them on
 */
export function comparable(children: Descendant[]): string {
  return canonical(children, (value) => (Text.isText(value) && value.text === '' ? { text: '' } : value))
}

/** JSON with sorted keys, for comparing values */
export function canonical(value: unknown, map: (value: unknown) => unknown = (v) => v): string {
  return JSON.stringify(value, (_key, original: unknown) => {
    const v = map(original)
    if (isRecord(v) && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    }
    return v
  })
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
