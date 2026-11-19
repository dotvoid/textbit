// Typed documents: a document's content is one tree, described by its type's
// schema, which client and server both read. Rich text is one kind of field.
//
// In Y.js 14 an object is a node whose fields are attributes: a single value
// is the attribute itself (last writer wins, one value on every client); a
// text field, an object or a list is a node held in the attribute. A list's
// items are child nodes ordered by a position attribute, never moved, so text
// inside an item keeps its identity, and what is anchored in it, when the
// list is reordered. Text fields are created with their parent, never on first
// use: two clients creating the same one at once would lose one's text.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { fieldToValue, seedField } from '@dotvoid/textbit/headless'
import type { Descendant } from 'slate'

export * from './comments'
export * from './attributions'

export type ScalarKind = 'string' | 'number' | 'boolean' | 'date' | 'id'

export interface ScalarField {
  kind: ScalarKind | 'oneOf'
  /** For `oneOf`: the values allowed */
  values?: readonly string[]
  optional?: boolean
}

export interface TextField {
  kind: 'text'
  /** The name of the plugin configuration editors use for it, e.g. `'singleLine'` */
  plugins?: string
}

export interface ObjectField {
  kind: 'object'
  fields: Record<string, Field>
}

export interface ListField {
  kind: 'list'
  of: ObjectField
  /** The field of each item that is its id, unique in the list */
  key: string
}

export type Field = ScalarField | TextField | ObjectField | ListField

export const string = (options: { optional?: boolean } = {}): ScalarField => ({ kind: 'string', ...options })
export const number = (options: { optional?: boolean } = {}): ScalarField => ({ kind: 'number', ...options })
export const boolean = (options: { optional?: boolean } = {}): ScalarField => ({ kind: 'boolean', ...options })
export const date = (options: { optional?: boolean } = {}): ScalarField => ({ kind: 'date', ...options })
export const id = (): ScalarField => ({ kind: 'id' })
export const oneOf = (values: readonly string[], options: { optional?: boolean } = {}): ScalarField => ({ kind: 'oneOf', values, ...options })
export const text = (options: { plugins?: string } = {}): TextField => ({ kind: 'text', ...options })
export const object = (fields: Record<string, Field>): ObjectField => ({ kind: 'object', fields })
export const list = (of: ObjectField, options: { key: string }): ListField => ({ kind: 'list', of, key: options.key })

/** A document type: its content, and the layers beside it it uses */
export interface TypeDefinition {
  name: string
  content: ObjectField
  /** Record kinds this type keeps, by name */
  records?: Record<string, { description?: string }>
  comments?: boolean
  suggestions?: boolean
  history?: boolean
}

export function defineType(name: string, definition: Omit<TypeDefinition, 'name'>): TypeDefinition {
  return { name, ...definition }
}

/** Where a node is in a document: attribute keys, and `#id` for list items */
export type Path = string[]

/** The positions of list items: fractional, so an item goes between any two */
export const POSITION = '_pos'

/**
 * Fills a new document's content from initial values: every field of the
 * schema is created, text fields included, empty where no value is given.
 */
export function createContent(root: Y.Node, schema: ObjectField, initial: Record<string, unknown> = {}): void {
  const doc = root.doc
  const fill = () => fillObject(root, schema, initial)
  if (doc) {
    doc.transact(fill)
  } else {
    fill()
  }
}

function fillObject(node: Y.Node, schema: ObjectField, values: Record<string, unknown>) {
  // First the attributes, nodes created empty; then what they hold, once they
  // are part of the document
  let d: delta.DeltaBuilderAny = delta.create()
  for (const [key, field] of Object.entries(schema.fields)) {
    const value = values[key]
    if (field.kind === 'text') {
      d = d.setAttr(key, new Y.Node('text'))
    } else if (field.kind === 'object') {
      d = d.setAttr(key, new Y.Node('object'))
    } else if (field.kind === 'list') {
      d = d.setAttr(key, new Y.Node('list'))
    } else if (value !== undefined) {
      d = d.setAttr(key, value)
    }
  }
  node.applyDelta(d.done())
  for (const [key, field] of Object.entries(schema.fields)) {
    const value = values[key]
    const child = node.getAttr(key)
    if (!(child instanceof Y.Node)) {
      continue
    }
    if (field.kind === 'text' && Array.isArray(value) && value.length) {
      seedField(child, value as Descendant[])
    } else if (field.kind === 'object') {
      fillObject(child, field, isRecord(value) ? value : {})
    } else if (field.kind === 'list' && Array.isArray(value)) {
      let previous: string | undefined
      for (const item of value) {
        if (isRecord(item)) {
          previous = between(previous, undefined)
          addItem(child, field, item, previous)
        }
      }
    }
  }
}

/** Adds an item to a list, with all its fields, at a position */
export function addItem(listNode: Y.Node, schema: ListField, values: Record<string, unknown>, position?: string): Y.Node {
  const key = values[schema.key]
  if (typeof key !== 'string' || !key) {
    throw new Error(`y-quorum: a list item needs its key, ${schema.key}`)
  }
  const at = position ?? between(lastPosition(listNode), undefined)
  let item: Y.Node | undefined
  const add = () => {
    listNode.applyDelta(delta.create().retain(listNode.length).insert([delta.create('item', { [POSITION]: at }).done()]).done())
    const added = listNode.get(listNode.length - 1)
    if (!(added instanceof Y.Node)) {
      throw new Error('y-quorum: the list item was not created')
    }
    // The item and everything in it in one change: never an item without its fields
    fillObject(added, schema.of, values)
    item = added
  }
  if (listNode.doc) {
    listNode.doc.transact(add)
  } else {
    add()
  }
  return item!
}

/** A list's items, as shown: by position, then by key */
export function itemsOf(listNode: Y.Node, schema?: ListField): Y.Node[] {
  const items: Y.Node[] = []
  for (let i = 0; i < listNode.length; i++) {
    const item = listNode.get(i)
    if (item instanceof Y.Node) {
      items.push(item)
    }
  }
  const keyOf = (item: Y.Node) => String(item.getAttr(schema?.key ?? 'id') ?? '')
  return items.sort((a, b) => {
    const pa = String(a.getAttr(POSITION) ?? '')
    const pb = String(b.getAttr(POSITION) ?? '')
    if (pa !== pb) {
      return pa < pb ? -1 : 1
    }
    return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0
  })
}

function lastPosition(listNode: Y.Node): string | undefined {
  const items = itemsOf(listNode)
  const last = items[items.length - 1]
  return last ? String(last.getAttr(POSITION)) : undefined
}

/** A position between two others, for ordering list items without moving them */
export function between(before?: string, after?: string): string {
  const low = before ?? ''
  const high = after ?? ''
  let result = ''
  for (let i = 0; ; i++) {
    const a = i < low.length ? low.charCodeAt(i) - 96 : 0
    const b = i < high.length ? high.charCodeAt(i) - 96 : 27
    if (b - a > 1) {
      return result + String.fromCharCode(96 + Math.floor((a + b) / 2))
    }
    result += String.fromCharCode(96 + a)
  }
}

/** A document's content as JSON: text fields as textbit values, lists as arrays in order */
export function toJSON(node: Y.Node, schema: ObjectField): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema.fields)) {
    const value = node.getAttr(key)
    out[key] = fieldToJSON(value, field)
  }
  return out
}

function fieldToJSON(value: unknown, field: Field): unknown {
  if (field.kind === 'text') {
    return value instanceof Y.Node ? fieldToValue(value) : []
  }
  if (field.kind === 'object') {
    return value instanceof Y.Node ? toJSON(value, field) : {}
  }
  if (field.kind === 'list') {
    return value instanceof Y.Node ? itemsOf(value, field).map((item) => toJSON(item, field.of)) : []
  }
  return value
}

/** The node or value at a path, and the schema of what is there */
export function resolvePath(root: Y.Node, schema: ObjectField, path: Path): { value: unknown, field: Field } | undefined {
  let value: unknown = root
  let field: Field = schema
  for (const segment of path) {
    if (field.kind === 'object' && value instanceof Y.Node) {
      const next: Field | undefined = field.fields[segment]
      if (!next) {
        return undefined
      }
      value = value.getAttr(segment)
      field = next
    } else if (field.kind === 'list' && value instanceof Y.Node && segment.startsWith('#')) {
      const key = segment.slice(1)
      const keyField = field.key
      value = itemsOf(value, field).find((item) => item.getAttr(keyField) === key)
      field = field.of
    } else {
      return undefined
    }
  }
  return { value, field }
}

/** The values at dot paths, as JSON: what a list watching documents shows */
export function projection(root: Y.Node, schema: ObjectField, paths: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const dotted of paths) {
    const resolved = resolvePath(root, schema, dotted.split('.'))
    out[dotted] = resolved ? fieldToJSON(resolved.value, resolved.field) : undefined
  }
  return out
}

/**
 * Where a node is in the document, as a path. Inside a text field the path
 * ends at the field: everything below it is the field's text.
 */
export function pathOf(node: Y.Node, root: Y.Node, schema: ObjectField): Path | undefined {
  const chain: Y.Node[] = []
  let current: Y.Node | null = node
  while (current && current !== root) {
    chain.unshift(current)
    current = current.parent
  }
  if (current !== root) {
    return undefined
  }
  const path: Path = []
  let field: Field = schema
  for (const step of chain) {
    if (field.kind === 'object') {
      const key = keyInParent(step)
      const next: Field | undefined = key !== null ? field.fields[key] : undefined
      if (key === null || !next) {
        return undefined
      }
      path.push(key)
      field = next
      if (field.kind === 'text') {
        return path // what is below is the field's text
      }
    } else if (field.kind === 'list') {
      path.push(`#${String(step.getAttr(field.key) ?? '?')}`)
      field = field.of
    } else {
      return path
    }
  }
  return path
}

// The attribute a node is held in, or null when it is a child in a list. Y.js
// keeps it on the node's item; there is no public way to read it yet.
function keyInParent(node: Y.Node): string | null {
  const item = (node as unknown as { _item?: { parentSub: string | null } | null })._item
  return item?.parentSub ?? null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
