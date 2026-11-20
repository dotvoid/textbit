// Binds a Slate editor to a text field in a Y.js 14 document.
//
// Slate to Y.js: each of the editor's own operations becomes a change to the
// field's nodes, worked out from the editor's state before the operation.
//
// Y.js to Slate: on anyone else's change (another client, another editor on the
// same field, an undo), the blocks it touched are read from Y.js and the editor
// is brought to them with the smallest Slate operations a comparison finds. The
// editor is never updated by replaying a delta, so it cannot drift from Y.js
// that way, and a change to a block puts that block right whatever it held.
//
// Loading and following others never write: those operations are not
// normalized, and not translated.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { Editor, Element, Node, Path, Point, Text, type Descendant, type Operation } from 'slate'
import {
  attrsOf,
  blocksOf,
  canonical,
  comparable,
  elementDelta,
  fieldToValue,
  holdsText,
  isInline,
  marksOf,
  sameLeaf,
  toSlateElement,
  withChildren,
  yLength,
  yOffset,
  childAt,
  type TBRenderer
} from './model'

/** What `bindField` takes */
export interface TBBindOptions {
  /**
   * The origin of this editor's changes in Y.js transactions. Default: a new
   * object. Give one to recognise the editor's changes elsewhere.
   */
  origin?: object
  /**
   * Shows the field through a Y.js 14 renderer, such as the suggestions view
   * of a fork: suggested insertions and deletions carry the `_suggested` mark,
   * and the editor writes in what it shows
   */
  renderer?: TBRenderer
  /** More of the document the editor's undo covers, such as a layer it changes with its edits */
  undoScope?: Y.Node[]
  /** Milliseconds within which changes are undone together. Default: Y.js's, `500`. */
  captureTimeout?: number
}

/** An editor's link to its text field, from `bindField` or `sharedOf` */
export interface TBSharedField {
  /** The text field */
  field: Y.Node
  /** The renderer the editor shows the field through, if any */
  renderer?: TBRenderer
  /** The origin of this editor's changes */
  origin: object
  /** Undoes and redoes this editor's own changes, and only them */
  undoManager: Y.UndoManager
  /**
   * Makes changes through this editor under another origin, such as an agent's
   * working in the person's editor: they are this editor's own changes, but
   * neither in its undo nor the person's in the document's history.
   */
  withOrigin(origin: unknown, change: () => void): void
  /** The origin changes are made under now: this editor's, or the one `withOrigin` set */
  currentOrigin(): unknown
  /** Whether the editor is applying someone else's change: plugins must leave those alone */
  isApplyingRemote(): boolean
  /** Whether the editor shows exactly what Y.js holds */
  check(): boolean
  /** Brings the editor to what Y.js holds; returns whether anything differed */
  reread(): boolean
  /** What happened, for watching: own operations, others' changes, re-reads that found a difference */
  stats: { local: number, remote: number, rereads: number }
  /** Unbinds the editor; it keeps its content and stops following the field */
  release(): void
}

const BOUND = new WeakMap<Editor, TBSharedField>()

/** The text field an editor is bound to, if any */
export function sharedOf(editor: Editor): TBSharedField | undefined {
  return BOUND.get(editor)
}

/**
 * Binds an editor to a text field: the editor shows the field, and its edits
 * change it. `createTextbitEditor` and `Textbit.Root` do this when given a
 * shared field.
 */
// Where an editor bound later than it is made, as React's is, takes its binding:
// at the core of its plugins, as when it is bound as it is made
const SLOTS = new WeakMap<Editor, { apply: Editor['apply'] }>()

/**
 * @internal Keeps the core of an editor's plugins for a binding made later,
 * so every operation the plugins make, as they make it, reaches the field.
 * Call it before the plugins wrap the editor.
 */
export function reserveBinding(editor: Editor): void {
  const slot = { apply: editor.apply }
  editor.apply = (op) => slot.apply(op)
  SLOTS.set(editor, slot)
}

export function bindField(editor: Editor, field: Y.Node, options: TBBindOptions = {}): TBSharedField {
  const doc = field.doc
  if (!doc) {
    throw new Error('textbit: the text field must be part of a Y.js document')
  }
  if (BOUND.has(editor)) {
    throw new Error('textbit: this editor is bound to a text field already')
  }
  const { renderer } = options
  const origin = options.origin ?? { textbit: 'editor' }
  const stats = { local: 0, remote: 0, rereads: 0 }
  // Applying others' changes: neither normalized nor translated
  let remote = false
  // The origin this editor writes under now
  let current: unknown = origin
  // Shown through a renderer, the editor follows its own changes too
  let followOwn = false
  // Applying its own operation: Y.js has it, Slate not yet. Anything that
  // would bring the editor to Y.js now waits until Slate has it too. What it
  // writes is its own by this, not by origin: another editor may write under
  // the same origin, and what it writes this editor has yet to show.
  let applyingOwn = false

  const read = () => fieldToValue(field, renderer)
  const write = (node: Y.Node, d: delta.DeltaAny) => {
    node.applyDelta(d, undefined, renderer ? { renderer } : undefined)
  }

  editor.children = read()

  const slot = SLOTS.get(editor)
  const apply = slot?.apply ?? editor.apply
  const { getDirtyPaths, undo, redo } = editor
  const setApply = (to: Editor['apply']) => {
    if (slot) {
      slot.apply = to
    } else {
      editor.apply = to
    }
  }
  editor.getDirtyPaths = (op) => (remote ? [] : getDirtyPaths(op))
  setApply((op: Operation) => {
    if (remote || op.type === 'set_selection') {
      apply(op)
      return
    }
    stats.local++
    applyingOwn = true
    try {
      if (op.type === 'move_node') {
        moveNode(op)
      } else {
        doc.transact(() => translate(op), current)
        apply(op)
      }
    } finally {
      applyingOwn = false
    }
    if (followOwn) {
      followOwn = false
      reconcile()
    }
  })

  function moveNode(op: Extract<Operation, { type: 'move_node' }>) {
    const node = Node.get(editor, op.path) as Descendant
    const removal = locate(op.path)
    apply(op)
    const target = Path.transform(op.path, op)
    doc!.transact(() => {
      write(removal.parent, at(removal.offset).delete(yLength(node)).done())
      if (target) {
        const destination = locate(target)
        write(destination.parent, withChildren(at(destination.offset), [node]).done())
      }
    }, current)
  }

  // The Y.js node of a Slate element, by its path
  function yNodeAt(path: Path): Y.Node {
    return yNodeAtPath(editor, field, path)
  }

  // The Y.js parent of a Slate node, and the node's offset in it
  function locate(path: Path) {
    const parentPath = Path.parent(path)
    const parent = parentPath.length ? (Node.get(editor, parentPath) as Element) : editor
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
        if (Text.isText(op.node) && !op.node.text) {
          return
        }
        const { parent, offset } = locate(op.path)
        write(parent, withChildren(at(offset), [op.node as Descendant]).done())
        return
      }
      case 'remove_node': {
        const length = yLength(op.node as Descendant)
        if (length) {
          const { parent, offset } = locate(op.path)
          write(parent, at(offset).delete(length).done())
        }
        return
      }
      case 'set_node': {
        const node = Node.get(editor, op.path) as Descendant
        if (Text.isText(node)) {
          const format: Record<string, unknown> = {}
          for (const key of keysOf(op.properties, op.newProperties)) {
            if (!key.startsWith('_')) {
              format[key] = (op.newProperties as Record<string, unknown>)[key] ?? null
            }
          }
          if (node.text.length && Object.keys(format).length) {
            const { parent, offset } = locate(op.path)
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
          return // in Y.js, leaves are runs of formatting: nothing to split
        }
        const element = node as Element
        const from = yOffset(element, op.position)
        const length = yOffset(element, element.children.length) - from
        if (length) {
          write(yNodeAt(op.path), at(from).delete(length).done())
        }
        const sibling = { ...(op.properties as Partial<Element>), children: element.children.slice(op.position) } as Element
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
        const previous = Node.get(editor, previousPath) as Element
        const end = yOffset(previous, previous.children.length)
        write(yNodeAt(previousPath), withChildren(at(end), (node as Element).children).done())
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
        const was = attrsOf({ properties: old.properties })
        const now = attrsOf({ properties: next.properties })
        for (const name of keysOf(was, now)) {
          if (now[name] === undefined) {
            y.deleteAttr(name)
          } else if (canonical(now[name]) !== canonical(was[name])) {
            y.setAttr(name, now[name])
          }
        }
        if (y.hasAttr('properties')) {
          y.deleteAttr('properties') // written by textbit 2: its properties now one by one
        }
        continue
      }
      // Slate removes what is set to null, as it does what is unset
      if (next[key] === undefined || next[key] === null) {
        y.deleteAttr(key)
      } else {
        y.setAttr(key, next[key])
      }
    }
  }

  // Y.js to Slate: inside blocks, block by block; when blocks come or go, the field
  const observer = (change: delta.DeltaAny) => {
    if (applyingOwn) {
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
    let whole = false
    try {
      Editor.withoutNormalizing(editor, () => {
        for (const index of blocks) {
          const current = editor.children[index]
          const node = childAt(field, index, renderer)
          const desired = node instanceof Y.Node ? toSlateElement(node, renderer) : undefined
          if (!current || !desired || !same(current, desired)) {
            whole = true
            return
          }
          update([index], current, desired)
        }
      })
    } finally {
      remote = false
    }
    if (whole) {
      reconcile()
    }
  }
  field.on('delta', observer)

  // Accepting or rejecting a suggestion changes what is shown, not the field
  const shown = () => {
    if (applyingOwn) {
      // e.g. a renderer passing the editor's own change on to the content
      followOwn = true
    } else if (!remote) {
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
    for (let k = 0; k < suffix; k++) {
      update(path.concat(current.length - 1 - k), current[current.length - 1 - k], desired[desired.length - 1 - k])
    }
    for (let k = 0; k < prefix; k++) {
      update(path.concat(k), current[k], desired[k])
    }
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
      return a.id !== undefined ? a.id === b.id : canonical(a) === canonical(b)
    }
    return false
  }

  function update(path: Path, current: Descendant, desired: Descendant) {
    if (comparable([current]) === comparable([desired])) {
      return
    }
    const a = current as unknown as Record<string, unknown> & Element
    const b = desired as unknown as Record<string, unknown> & Element
    const properties: Record<string, unknown> = {}
    const newProperties: Record<string, unknown> = {}
    for (const key of keysOf(a, b)) {
      if (key !== 'children' && canonical(a[key]) !== canonical(b[key])) {
        properties[key] = a[key]
        newProperties[key] = b[key]
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

  // Text in one element: leaf by leaf when only text changed, otherwise all of
  // it, keeping the selection at the same character
  function updateText(path: Path, current: Element, desired: Element) {
    const a = current.children
    const b = desired.children
    const alike = a.length === b.length && a.every((child, i) => {
      const other = b[i]
      if (Text.isText(child) && Text.isText(other)) {
        return sameLeaf(child, other) || (child.text === '' && other.text === '')
      }
      return isInline(child) && isInline(other) && (child as Element).id === (other as Element).id
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
    // The caret stays by the same character: past what changed, it moves by
    // what was added or removed before it
    const shift = shifted(Node.string(current), Node.string(desired))
    const anchor = selection && shift(offsetIn(path, selection.anchor))
    const focus = selection && shift(offsetIn(path, selection.focus))
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

  // A point in an element as a character offset, and back
  // Where an offset in a text is once it changed: before the change it stays,
  // after the change it moves with the text, in it it goes to its end
  function shifted(before: string, after: string) {
    let start = 0
    while (start < before.length && start < after.length && before[start] === after[start]) {
      start++
    }
    let end = 0
    while (end < before.length - start && end < after.length - start &&
      before[before.length - 1 - end] === after[after.length - 1 - end]) {
      end++
    }
    return (offset: number | null) => offset === null || offset <= start
      ? offset
      : offset >= before.length - end
        ? offset + after.length - before.length
        : after.length - end
  }

  function offsetIn(path: Path, point: Point): number | null {
    if (!Path.isAncestor(path, point.path)) {
      return null
    }
    let offset = 0
    for (const [text, textPath] of Node.texts(Node.get(editor, path))) {
      if (Path.equals(path.concat(textPath), point.path)) {
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

  const undoManager = new Y.UndoManager([field, ...(options.undoScope ?? [])], {
    trackedOrigins: new Set([origin]),
    ...(options.captureTimeout !== undefined ? { captureTimeout: options.captureTimeout } : {})
  })
  editor.undo = () => {
    undoManager.undo()
  }
  editor.redo = () => {
    undoManager.redo()
  }

  const shared: TBSharedField = {
    field,
    ...(renderer ? { renderer } : {}),
    origin,
    undoManager,
    stats,
    isApplyingRemote: () => remote,
    currentOrigin: () => current,
    withOrigin: (other, change) => {
      const previous = current
      current = other
      try {
        change()
      } finally {
        current = previous
      }
    },
    check: () => comparable(blocksOf(editor.children)) === comparable(read()),
    reread: () => {
      const differed = reconcile()
      if (differed) {
        stats.rereads++
      }
      return differed
    },
    release: () => {
      field.off('delta', observer)
      events?.off('change', shown)
      undoManager.destroy()
      setApply(apply)
      editor.getDirtyPaths = getDirtyPaths
      editor.undo = undo
      editor.redo = redo
      BOUND.delete(editor)
    }
  }
  BOUND.set(editor, shared)
  return shared
}

/** The Y.js node of a Slate element in a field, by its path */
export function yNodeAtPath(editor: Editor, field: Y.Node, path: Path): Y.Node {
  // Through the editor's renderer, as it shows the field: offsets count what
  // is suggested deleted too
  const renderer = BOUND.get(editor)?.renderer
  let y = field
  let slate: { children: Descendant[] } = editor
  for (const index of path) {
    const child = childAt(y, yOffset(slate, index), renderer)
    if (!(child instanceof Y.Node)) {
      throw new Error(`textbit: no Y.js node at ${JSON.stringify(path)}`)
    }
    y = child
    slate = slate.children[index] as Element
  }
  return y
}

// The indexes of the blocks a change modified, or nothing when blocks were
// added or removed. Read by their fields: more than one copy of lib0 may be
// loaded, so its classes cannot be told apart with instanceof.
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

function keysOf(...objects: object[]): string[] {
  return [...new Set(objects.flatMap((o) => Object.keys(o)))]
}
