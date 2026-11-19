// A small typed tree, as the spike had it, for testing text fields inside one
// A typed document tree in Y.js 14: objects as nodes whose fields are
// attributes, single values as plain attributes (last writer wins, one value
// on every client), text fields as nodes held in attributes, keyed lists as
// nodes whose items are ordered by a position attribute, never by moving them.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'

export interface ItemInit {
  id: string
  pos: string
  status: string
}

/** Creates a plan: a title, a due date and a list of assignments */
export function createPlan(doc: Y.Doc, { due }: { due: string }) {
  const root = doc.get('content')
  doc.transact(() => {
    root.applyDelta(delta.create()
      .setAttr('title', new Y.Node('text'))
      .setAttr('due', due)
      .setAttr('assignments', new Y.Node('list'))
      .done())
  })
  return root
}

export function listOf(root: Y.Node, key: string): Y.Node {
  const list = root.getAttr(key)
  if (!(list instanceof Y.Node)) {
    throw new Error(`No list ${key}`)
  }
  return list
}

export function textField(node: Y.Node, key: string): Y.Node {
  const field = node.getAttr(key)
  if (!(field instanceof Y.Node)) {
    throw new Error(`No text field ${key}`)
  }
  return field
}

/** Adds an item, with its text fields created with it, never later */
export function addItem(list: Y.Node, item: ItemInit) {
  list.applyDelta(delta.create()
    .retain(list.length)
    .insert([delta.create('item', { ...item, title: new Y.Node('text'), description: new Y.Node('text') }).done()])
    .done())
}

/** The items as they are shown: by position, then by id */
export function orderedItems(list: Y.Node): Y.Node[] {
  return itemsOf(list).sort((a, b) => {
    const pa = String(a.getAttr('pos'))
    const pb = String(b.getAttr('pos'))
    return pa < pb ? -1 : pa > pb ? 1 : String(a.getAttr('id')) < String(b.getAttr('id')) ? -1 : 1
  })
}

export function itemsOf(list: Y.Node): Y.Node[] {
  const items: Y.Node[] = []
  for (let i = 0; i < list.length; i++) {
    const item = list.get(i)
    if (item instanceof Y.Node) {
      items.push(item)
    }
  }
  return items
}

export function findItem(list: Y.Node, id: string): Y.Node | undefined {
  return itemsOf(list).find((item) => item.getAttr('id') === id)
}

/**
 * Removes copies of items with the same id, keeping the first by Y.js id. For
 * the owner alone: if every client removed "the other" copy, all could go.
 */
export function removeCopies(list: Y.Node): number {
  const byId = new Map<string, Y.Node[]>()
  for (const item of itemsOf(list)) {
    const id = String(item.getAttr('id'))
    byId.set(id, [...(byId.get(id) ?? []), item])
  }
  let removed = 0
  for (const copies of byId.values()) {
    if (copies.length < 2) {
      continue
    }
    const [, ...extra] = copies.sort((a, b) => compareIds(yId(a), yId(b)))
    for (const item of extra) {
      const index = itemsOf(list).indexOf(item)
      list.applyDelta(delta.create().retain(index).delete(1).done())
      removed++
    }
  }
  return removed
}

// The Y.js id of a node's item. Internal to Y.js: a public way to read it would
// be needed for this.
function yId(node: Y.Node): { client: number, clock: number } {
  const item = (node as unknown as { _item?: { id: { client: number, clock: number } } })._item
  if (!item) {
    throw new Error('A node without an item')
  }
  return item.id
}

function compareIds(a: { client: number, clock: number }, b: { client: number, clock: number }) {
  return a.client - b.client || a.clock - b.clock
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

/** The values of chosen fields as JSON, for a list watching documents */
export function projection(root: Y.Node, paths: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const path of paths) {
    const value = root.getAttr(path)
    out[path] = value instanceof Y.Node ? plainText(value) : value
  }
  return out
}

function plainText(node: Y.Node): string {
  let text = ''
  for (const op of node.toDelta().children) {
    const insert = (op as { insert?: unknown }).insert
    if (typeof insert === 'string') {
      text += insert
    } else if (Array.isArray(insert)) {
      for (const child of insert) {
        if (child instanceof Y.Node) {
          text += plainText(child) + (child.getAttr('class') === 'inline' ? '' : '\n')
        }
      }
    }
  }
  return text.trimEnd()
}
