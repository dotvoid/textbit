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
      // Items that are not objects with their key are left out, as a value
      // of the wrong kind is: nothing is half written
      for (const item of value) {
        if (isRecord(item) && typeof item[field.key] === 'string' && item[field.key] !== '') {
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

/** What a document holds that its type does not allow, outside its text */
export interface FieldIssue {
  path: Path
  /**
   * `value`: a plain value of the wrong kind; `slot`: no text field, object or
   * list where the type has one; `key`: a list item without its key, or with
   * the key of an item before it
   */
  code: 'value' | 'slot' | 'key'
  message: string
  /** For `key`: the item */
  item?: Y.Node
}

/** Whether a plain value fits its field. Nothing fits any field: a value not given. */
export function valueFits(field: ScalarField, value: unknown): boolean {
  if (value === undefined) {
    return true
  }
  switch (field.kind) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'date':
      return typeof value === 'string' && isDate(value)
    case 'id':
      return typeof value === 'string' && value.length > 0
    case 'oneOf':
      return typeof value === 'string' && (field.values ?? []).includes(value)
  }
}

// An ISO 8601 date, with a time or without
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2})(:(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

// A day the calendar has, at a time the clock has: not 31 February
function isDate(value: string): boolean {
  const parts = ISO_DATE.exec(value)
  if (!parts) {
    return false
  }
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const calendar = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  const clock = parts[4] === undefined ||
    (Number(parts[5]) < 24 && Number(parts[6]) < 60 && Number(parts[8] ?? 0) < 60)
  return calendar && clock && !Number.isNaN(Date.parse(value))
}

/**
 * What a document's content holds that its type does not allow, but in its
 * text fields, whose rules are textbit's: plain values of the wrong kind,
 * fields that are not what the type says, list items without a key or with
 * one an earlier item has. Items in the order they are shown.
 */
export function fieldIssues(root: Y.Node, schema: ObjectField): FieldIssue[] {
  const issues: FieldIssue[] = []
  checkObject(root, schema, [], issues)
  return issues
}

function checkObject(node: Y.Node, schema: ObjectField, path: Path, issues: FieldIssue[]) {
  for (const [key, field] of Object.entries(schema.fields)) {
    const value = node.getAttr(key)
    const at = [...path, key]
    if (field.kind === 'text' || field.kind === 'object' || field.kind === 'list') {
      if (!(value instanceof Y.Node)) {
        issues.push({ path: at, code: 'slot', message: `${at.join('.')} must be ${a(field.kind)}` })
      } else if (field.kind === 'object') {
        checkObject(value, field, at, issues)
      } else if (field.kind === 'list') {
        checkList(value, field, at, issues)
      }
    } else if (!valueFits(field, value)) {
      const message = `${at.join('.')} must be ${expected(field)}`
      issues.push({ path: at, code: 'value', message })
    }
  }
}

function checkList(node: Y.Node, schema: ListField, path: Path, issues: FieldIssue[]) {
  const seen = new Set<string>()
  for (const item of itemsOf(node, schema)) {
    const key = item.getAttr(schema.key)
    if (typeof key !== 'string' || !key || seen.has(key)) {
      const message = typeof key === 'string' && key
        ? `${path.join('.')} has more than one item ${key}`
        : `${path.join('.')} has an item without its ${schema.key}`
      issues.push({ path: [...path, `#${String(key ?? '?')}`], code: 'key', message, item })
      continue
    }
    seen.add(key)
    checkObject(item, schema.of, [...path, `#${key}`], issues)
  }
}

function a(kind: 'text' | 'object' | 'list'): string {
  return kind === 'text' ? 'a text field' : kind === 'object' ? 'an object' : 'a list'
}

function expected(field: ScalarField): string {
  if (field.kind === 'oneOf') {
    return `one of ${(field.values ?? []).map((value) => JSON.stringify(value)).join(', ')}`
  }
  if (field.kind === 'date') {
    return 'an ISO 8601 date'
  }
  return field.kind === 'id' ? 'an id' : `a ${field.kind}`
}

/**
 * Writes one field of an object from JSON, as `createContent` fills it: a text
 * field, object or list as a new node holding the value, a plain value as it
 * is, nothing given removing it
 */
export function writeField(node: Y.Node, key: string, field: Field, value: unknown): void {
  const write = () => {
    const plain = field.kind !== 'text' && field.kind !== 'object' && field.kind !== 'list'
    if (value === undefined && plain) {
      node.deleteAttr(key)
      return
    }
    fillObject(node, { kind: 'object', fields: { [key]: field } }, { [key]: value })
  }
  if (node.doc) {
    node.doc.transact(write)
  } else {
    write()
  }
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
