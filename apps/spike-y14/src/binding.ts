// Binds a Slate editor to a text field in a Y.js 14 document.
//
// Slate to Y.js: each local operation is translated into a change to the Y.js
// nodes, from the editor's state before the operation.
//
// Y.js to Slate: on a change from anyone else (another client, another editor in
// the same tab, an undo), the changed field is read from Y.js and the editor is
// brought to it with the smallest Slate operations found by comparing the two.
// The editor is never updated by replaying the delta, so it cannot drift from
// Y.js: every remote change also corrects whatever differed before.
//
// Loading and remote changes never write to Y.js: they are not normalized, and
// their operations are not translated.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { Editor, Element, Node, Path, Point, Text, type Descendant, type Operation } from 'slate'
import {
  attrsOf,
  blocksOf,
  canonical,
  comparable,
  elementDelta,
  holdsText,
  isInline,
  marksOf,
  sameLeaf,
  toSlateElement,
  toSlateValue,
  yLength,
  yOffset,
  type Renderer,
  type SlateElement
} from './model.ts'

export interface FieldBinding {
  /** The transaction origin of this editor's changes */
  origin: object
  /** Whether the editor shows exactly what Y.js holds */
  check(): boolean
  /** Brings the editor to what Y.js holds; returns whether anything differed */
  reread(): boolean
  undo(): void
  redo(): void
  destroy(): void
  /** What happened, for the counters a host would watch */
  stats: { local: number, remote: number, rereads: number }
}

export interface BindOptions {
  name?: string
  /**
   * Shows the field through a renderer, as Y.js 14's DiffRenderer shows a
   * suggestions fork: suggested insertions and deletions as `_suggested` marks,
   * and writes made in what is shown
   */
  renderer?: Renderer
}

export function bindField(editor: Editor, field: Y.Node, { name = 'editor', renderer }: BindOptions = {}): FieldBinding {
  const doc = field.doc
  if (!doc) {
    throw new Error('The field must belong to a document')
  }
  const origin = { name }
  const stats = { local: 0, remote: 0, rereads: 0 }
  let remote = false
  let followOwn = false

  const read = () => toSlateValue(field, renderer)
  const write = (node: Y.Node, d: delta.DeltaAny) => {
    node.applyDelta(d, undefined, renderer ? { renderer } : undefined)
  }

  editor.children = read()

  // Remote operations mark nothing for normalization: what they bring is already
  // in the shape Slate normalizes to, and normalizing it could write
  const { apply, getDirtyPaths } = editor
  editor.getDirtyPaths = (op) => (remote ? [] : getDirtyPaths(op))
  editor.apply = (op: Operation) => {
    if (remote || op.type === 'set_selection') {
      apply(op)
      return
    }
    stats.local++
    if (op.type === 'move_node') {
      const node = Node.get(editor, op.path)
      const removal = locate(op.path)
      apply(op)
      const target = Path.transform(op.path, op)
      doc.transact(() => {
        write(removal.parent, at(removal.offset).delete(yLength(node)).done())
        if (target) {
          const destination = locate(target)
          write(destination.parent, withChildren(at(destination.offset), [node]).done())
        }
      }, origin)
      return
    }
    doc.transact(() => translate(op), origin)
    apply(op)
    if (followOwn) {
      followOwn = false
      reconcile()
    }
  }

  // The Y.js node of a Slate element, by its path
  function yNodeAt(path: Path): Y.Node {
    let y = field
    let slate: { children: Descendant[] } = editor
    for (const index of path) {
      const child = y.get(yOffset(slate, index))
      if (!(child instanceof Y.Node)) {
        throw new Error(`No Y.js node at ${JSON.stringify(path)}`)
      }
      y = child
      slate = slate.children[index] as SlateElement
    }
    return y
  }

  // The Y.js parent of a Slate node and the node's offset in it
  function locate(path: Path) {
    const parentPath = Path.parent(path)
    const parent = parentPath.length ? (Node.get(editor, parentPath) as SlateElement) : editor
    return { parent: yNodeAt(parentPath), offset: yOffset(parent, path[path.length - 1]) }
  }

  function translate(op: Operation) {
    switch (op.type) {
      case 'insert_text': {
        const leaf = Node.get(editor, op.path) as Text
        const { parent, offset } = locate(op.path)
        write(parent, at(offset + op.offset).insert(op.text, marksOf(leaf) ?? null).done())
        return
      }
      case 'remove_text': {
        const { parent, offset } = locate(op.path)
        write(parent, at(offset + op.offset).delete(op.text.length).done())
        return
      }
      case 'insert_node': {
        const { parent, offset } = locate(op.path)
        if (Text.isText(op.node) && !op.node.text) {
          return
        }
        write(parent, withChildren(at(offset), [op.node]).done())
        return
      }
      case 'remove_node': {
        const length = yLength(op.node)
        if (length) {
          const { parent, offset } = locate(op.path)
          write(parent, at(offset).delete(length).done())
        }
        return
      }
      case 'set_node': {
        const node = Node.get(editor, op.path)
        if (Text.isText(node)) {
          const format: Record<string, unknown> = {}
          for (const key of keysOf(op.properties, op.newProperties)) {
            format[key] = (op.newProperties as Record<string, unknown>)[key] ?? null
          }
          const { parent, offset } = locate(op.path)
          if (node.text.length) {
            write(parent, at(offset).retain(node.text.length, format).done())
          }
          return
        }
        setAttributes(yNodeAt(op.path), op.properties, op.newProperties)
        return
      }
      case 'split_node': {
        const node = Node.get(editor, op.path)
        if (Text.isText(node)) {
          return // Leaves are runs of formatting in Y.js: nothing to split
        }
        const element = node as SlateElement
        const y = yNodeAt(op.path)
        const tail = element.children.slice(op.position)
        const from = yOffset(element, op.position)
        const length = yOffset(element, element.children.length) - from
        if (length) {
          write(y, at(from).delete(length).done())
        }
        const sibling = { ...(op.properties as Partial<SlateElement>), children: tail } as SlateElement
        const { parent, offset } = locate(op.path)
        write(parent, at(offset + 1).insert([elementDelta(sibling)]).done())
        return
      }
      case 'merge_node': {
        const node = Node.get(editor, op.path)
        if (Text.isText(node)) {
          return
        }
        const previousPath = Path.previous(op.path)
        const previous = Node.get(editor, previousPath) as SlateElement
        const end = yOffset(previous, previous.children.length)
        write(yNodeAt(previousPath), withChildren(at(end), (node as SlateElement).children).done())
        const { parent, offset } = locate(op.path)
        write(parent, at(offset).delete(1).done())
        return
      }
    }
  }

  function setAttributes(y: Y.Node, before: object, after: object) {
    const old = before as Record<string, unknown>
    const next = after as Record<string, unknown>
    for (const key of keysOf(before, after)) {
      if (key === 'properties') {
        const was = attrsOf({ properties: old.properties, children: [] } as SlateElement)
        const now = attrsOf({ properties: next.properties, children: [] } as SlateElement)
        for (const name of keysOf(was, now)) {
          if (now[name] === undefined) {
            y.deleteAttr(name)
          } else if (canonical(now[name]) !== canonical(was[name])) {
            y.setAttr(name, now[name])
          }
        }
        if (y.hasAttr('properties')) {
          y.deleteAttr('properties') // a Y.js 13 element: its properties now one by one
        }
        continue
      }
      if (next[key] === undefined) {
        y.deleteAttr(key)
      } else {
        y.setAttr(key, next[key])
      }
    }
  }

  // Y.js to Slate. A change inside blocks is compared block by block, a change
  // to which blocks there are is compared for the whole field.
  const observer = (change: delta.DeltaAny, changeOrigin: unknown) => {
    if (changeOrigin === origin) {
      // Shown through a renderer, what the editor wrote may show differently (a
      // deletion stays, struck): caught up once Slate has applied the operation
      followOwn = Boolean(renderer)
      return
    }
    stats.remote++
    const blocks = changedBlocks(change)
    if (!blocks) {
      reconcile()
      return
    }
    remote = true
    try {
      Editor.withoutNormalizing(editor, () => {
        for (const index of blocks) {
          const current = editor.children[index]
          const node = field.get(index)
          const desired = node instanceof Y.Node ? toSlateElement(node, renderer) : undefined
          if (!current || !desired || !same(current, desired)) {
            remote = false
            reconcile()
            return
          }
          update([index], current, desired)
        }
      })
    } finally {
      remote = false
    }
  }
  field.on('delta', observer)

  // Accepting or rejecting a suggestion changes what is shown without changing
  // the field: the renderer says so
  const shown = () => {
    if (!remote) {
      reconcile()
    }
  }
  const events = renderer && 'on' in renderer && 'off' in renderer
    ? (renderer as unknown as { on: (name: string, f: () => void) => void, off: (name: string, f: () => void) => void })
    : undefined
  events?.on('change', shown)

  function reconcile(): boolean {
    const desired = read()
    if (comparable(blocksOf(editor.children)) === comparable(desired)) {
      return false
    }
    remote = true
    try {
      Editor.withoutNormalizing(editor, () => {
        reconcileElements([], editor.children, desired)
      })
    } finally {
      remote = false
    }
    return true
  }

  function reconcileElements(path: Path, current: Descendant[], desired: Descendant[]) {
    let prefix = 0
    while (prefix < current.length && prefix < desired.length && same(current[prefix], desired[prefix])) {
      prefix++
    }
    let suffix = 0
    while (
      suffix < current.length - prefix &&
      suffix < desired.length - prefix &&
      same(current[current.length - 1 - suffix], desired[desired.length - 1 - suffix])
    ) {
      suffix++
    }
    // The same elements at both ends are brought up to date where they are
    for (let k = 0; k < suffix; k++) {
      update(path.concat(current.length - 1 - k), current[current.length - 1 - k], desired[desired.length - 1 - k])
    }
    for (let k = 0; k < prefix; k++) {
      update(path.concat(k), current[k], desired[k])
    }
    // The elements between are replaced
    const removed = current.slice(prefix, current.length - suffix)
    for (let k = removed.length - 1; k >= 0; k--) {
      editor.apply({ type: 'remove_node', path: path.concat(prefix + k), node: removed[k] })
    }
    desired.slice(prefix, desired.length - suffix).forEach((node, k) => {
      editor.apply({ type: 'insert_node', path: path.concat(prefix + k), node })
    })
  }

  function same(a: Descendant, b: Descendant): boolean {
    if (Element.isElement(a) && Element.isElement(b)) {
      const idA = (a as SlateElement).id
      const idB = (b as SlateElement).id
      return idA !== undefined ? idA === idB : canonical(a) === canonical(b)
    }
    return false
  }

  function update(path: Path, current: Descendant, desired: Descendant) {
    if (comparable([current]) === comparable([desired])) {
      return
    }
    const a = current as SlateElement
    const b = desired as SlateElement
    const properties: Record<string, unknown> = {}
    const newProperties: Record<string, unknown> = {}
    for (const key of keysOf(a, b)) {
      if (key !== 'children' && canonical(a[key as keyof SlateElement]) !== canonical(b[key as keyof SlateElement])) {
        properties[key] = a[key as keyof SlateElement]
        newProperties[key] = b[key as keyof SlateElement]
      }
    }
    if (Object.keys(newProperties).length) {
      editor.apply({ type: 'set_node', path, properties, newProperties })
    }
    if (holdsText(a) && holdsText(b)) {
      updateText(path, a, b)
    } else {
      reconcileElements(path, a.children, b.children)
    }
  }

  // Text in one element: leaf by leaf when only the text changed, otherwise all
  // of it, keeping the selection at the same character
  function updateText(path: Path, current: SlateElement, desired: SlateElement) {
    const a = current.children
    const b = desired.children
    const alike = a.length === b.length && a.every((child, i) => {
      const other = b[i]
      if (Text.isText(child) && Text.isText(other)) {
        return sameLeaf(child, other) || (child.text === '' && other.text === '')
      }
      return isInline(child) && isInline(other) && (child as SlateElement).id === (other as SlateElement).id
    })
    if (alike) {
      a.forEach((child, i) => {
        const other = b[i]
        if (Text.isText(child) && Text.isText(other)) {
          replaceText(path.concat(i), child.text, other.text)
        } else {
          update(path.concat(i), child, other)
        }
      })
      return
    }
    const selection = editor.selection
    const anchor = selection && offsetIn(path, selection.anchor)
    const focus = selection && offsetIn(path, selection.focus)
    for (let i = a.length - 1; i >= 0; i--) {
      editor.apply({ type: 'remove_node', path: path.concat(i), node: a[i] })
    }
    b.forEach((node, i) => editor.apply({ type: 'insert_node', path: path.concat(i), node }))
    if (selection && (anchor !== null || focus !== null)) {
      const newAnchor = anchor !== null ? pointAt(path, anchor) : editor.selection?.anchor
      const newFocus = focus !== null ? pointAt(path, focus) : editor.selection?.focus
      if (newAnchor && newFocus) {
        editor.apply({ type: 'set_selection', properties: editor.selection, newProperties: { anchor: newAnchor, focus: newFocus } })
      }
    }
  }

  function replaceText(path: Path, before: string, after: string) {
    let start = 0
    while (start < before.length && start < after.length && before[start] === after[start]) {
      start++
    }
    let end = 0
    while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
      end++
    }
    const removed = before.slice(start, before.length - end)
    const inserted = after.slice(start, after.length - end)
    if (removed) {
      editor.apply({ type: 'remove_text', path, offset: start, text: removed })
    }
    if (inserted) {
      editor.apply({ type: 'insert_text', path, offset: start, text: inserted })
    }
  }

  // A point inside an element as a character offset, and back
  function offsetIn(path: Path, point: Point): number | null {
    if (!Path.isAncestor(path, point.path)) {
      return null
    }
    let offset = 0
    for (const [text, textPath] of Node.texts(Node.get(editor, path))) {
      const full = path.concat(textPath)
      if (Path.equals(full, point.path)) {
        return offset + point.offset
      }
      offset += text.text.length
    }
    return offset
  }

  function pointAt(path: Path, offset: number): Point {
    let rest = offset
    let last: Point = { path: path.concat(0), offset: 0 }
    for (const [text, textPath] of Node.texts(Node.get(editor, path))) {
      last = { path: path.concat(textPath), offset: text.text.length }
      if (rest <= text.text.length) {
        return { path: path.concat(textPath), offset: rest }
      }
      rest -= text.text.length
    }
    return last
  }

  const undoManager = new Y.UndoManager(field, { trackedOrigins: new Set([origin]) })

  return {
    origin,
    stats,
    check: () => comparable(blocksOf(editor.children)) === comparable(read()),
    reread: () => {
      const differed = reconcile()
      if (differed) {
        stats.rereads++
      }
      return differed
    },
    undo: () => undoManager.undo(),
    redo: () => undoManager.redo(),
    destroy: () => {
      field.off('delta', observer)
      events?.off('change', shown)
      undoManager.destroy()
      editor.apply = apply
      editor.getDirtyPaths = getDirtyPaths
    }
  }
}

// The indexes of the blocks a change modified, or nothing when blocks were
// added or removed. Read by their fields: there may be more than one copy of
// lib0 loaded, so its classes cannot be told apart with instanceof.
function changedBlocks(change: delta.DeltaAny): number[] | undefined {
  const blocks: number[] = []
  let index = 0
  for (const op of change.children) {
    if ('retain' in op && typeof op.retain === 'number') {
      if (op.format) {
        return undefined
      }
      index += op.retain
    } else if ('value' in op) {
      blocks.push(index)
      index++
    } else {
      return undefined
    }
  }
  return blocks
}

function at(offset: number): delta.DeltaBuilderAny {
  const d: delta.DeltaBuilderAny = delta.create()
  return offset ? d.retain(offset) : d
}

// Appends Slate nodes to a delta as inserts, with their formats
function withChildren(d: delta.DeltaBuilderAny, nodes: Descendant[]): delta.DeltaBuilderAny {
  let next = d
  for (const node of nodes) {
    if (Text.isText(node)) {
      if (node.text) {
        next = next.insert(node.text, marksOf(node) ?? null)
      }
    } else {
      next = next.insert([elementDelta(node as SlateElement)])
    }
  }
  return next
}

function keysOf(...objects: object[]): string[] {
  return [...new Set(objects.flatMap((o) => Object.keys(o)))]
}
