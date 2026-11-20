// Suggestions, the way Y.js 14 makes them: a fork of the shared text, shown
// through a diff renderer as what it would add and remove. An editor bound to
// the fork's field through that renderer shows suggested text with the
// `_suggested` mark; this reads those marks as changes a person can accept or
// reject one at a time, each by the Y.js item where it starts. Y.js widens an
// item to the whole run of suggested content around it, and a suggested block
// to everything in it.
import * as Y from '@y/y'
import { Editor, Element, Node, Path, Text, type Range } from 'slate'
import { sharedOf, yNodeAtPath } from '../yjs/binding'
import { BY_MARK, AT_MARK, SUGGESTED_MARK, yOffset } from '../yjs/model'

/** One suggested change as the editor shows it */
export interface SuggestedChange {
  /** Where it starts, stable while it is there */
  id: string
  kind: 'insert' | 'delete' | 'replace'
  /** The text it adds */
  inserted: string
  /** The text it removes */
  deleted: string
  /** Who suggested it, by the key attributions name them with, when known */
  by?: string
  /** When, in milliseconds, when known */
  at?: number
  /** Whether it is a whole block suggested, added or removed */
  block: boolean
  /** Where it is in the editor */
  range: Range
}

/** The renderer an editor shows a fork through, if it shows one */
export function diffRendererOf(editor: Editor): Y.DiffRenderer | undefined {
  const renderer = sharedOf(editor)?.renderer
  return renderer instanceof Y.DiffRenderer ? renderer : undefined
}

type Marked = Text & { [SUGGESTED_MARK]?: 'insert' | 'delete', [BY_MARK]?: string, [AT_MARK]?: number }

/** The suggested changes in an editor showing a fork, in the order of the text */
export function suggestedChanges(editor: Editor): SuggestedChange[] {
  const renderer = diffRendererOf(editor)
  if (!renderer) {
    return []
  }
  const changes: SuggestedChange[] = []
  // A block suggested whole is one change, whatever is in it
  const visit = (children: Node[], parentPath: Path) => {
    children.forEach((element, index) => {
      if (!Element.isElement(element) || Editor.isInline(editor, element)) {
        return
      }
      const path = [...parentPath, index]
      const whole = blockSuggestion(editor, renderer, path)
      if (whole) {
        const leaf = Node.texts(element).next().value?.[0] as Marked | undefined
        const text = Node.string(element)
        changes.push({
          id: `${String(element.id ?? path.join('.'))}:block`,
          kind: whole,
          inserted: whole === 'insert' ? text : '',
          deleted: whole === 'delete' ? text : '',
          ...(leaf?.[BY_MARK] ? { by: leaf[BY_MARK] } : {}),
          ...(leaf?.[AT_MARK] !== undefined ? { at: leaf[AT_MARK] } : {}),
          block: true,
          range: Editor.range(editor, path)
        })
      } else if (element.children.some(Text.isText)) {
        changes.push(...runsIn(element, path))
      } else {
        visit(element.children, path)
      }
    })
  }
  visit(editor.children, [])
  return changes
}

/** Accepts a change into the shared text */
export function acceptChange(editor: Editor, change: SuggestedChange): void {
  const at = itemOf(editor, change)
  if (at) {
    diffRendererOf(editor)!.acceptChanges(at)
  }
}

/** Rejects a change: the fork goes back to the shared text there */
export function rejectChange(editor: Editor, change: SuggestedChange): void {
  const at = itemOf(editor, change)
  if (at) {
    diffRendererOf(editor)!.rejectChanges(at)
  }
}

// Runs of suggested text in a block, delete and insert side by side as one
// replacement, split where the author changes
function runsIn(element: Element, path: Path): SuggestedChange[] {
  const changes: SuggestedChange[] = []
  let open: SuggestedChange | undefined
  let offset = 0
  element.children.forEach((child, index) => {
    if (!Text.isText(child)) {
      open = undefined
      offset += Node.string(child).length
      return
    }
    const leaf = child as Marked
    const kind = leaf[SUGGESTED_MARK]
    const start = offset
    offset += leaf.text.length
    if (!kind || !leaf.text) {
      open = undefined
      return
    }
    const leafPath = [...path, index]
    if (open && open.by === leaf[BY_MARK]) {
      open.kind = open.kind === kind ? kind : 'replace'
      open[kind === 'insert' ? 'inserted' : 'deleted'] += leaf.text
      open.range = { anchor: open.range.anchor, focus: { path: leafPath, offset: leaf.text.length } }
      return
    }
    open = {
      id: `${String(element.id ?? path.join('.'))}:${start}`,
      kind,
      inserted: kind === 'insert' ? leaf.text : '',
      deleted: kind === 'delete' ? leaf.text : '',
      ...(leaf[BY_MARK] ? { by: leaf[BY_MARK] } : {}),
      ...(leaf[AT_MARK] !== undefined ? { at: leaf[AT_MARK] } : {}),
      block: false,
      range: { anchor: { path: leafPath, offset: 0 }, focus: { path: leafPath, offset: leaf.text.length } }
    }
    changes.push(open)
  })
  return changes
}

// Whether a whole block is suggested, added or removed: its own item is
function blockSuggestion(editor: Editor, renderer: Y.DiffRenderer, path: Path): 'insert' | 'delete' | undefined {
  const item = blockItem(editor, path)
  if (!item) {
    return undefined
  }
  if (renderer.inserts.has(item.client, item.clock)) {
    return 'insert'
  }
  if (renderer.deletes.has(item.client, item.clock)) {
    return 'delete'
  }
  return undefined
}

// The Y.js item of the block at a path, as the renderer shows it
function blockItem(editor: Editor, path: Path): Y.ID | undefined {
  const shared = sharedOf(editor)
  if (!shared || !path.length) {
    return undefined
  }
  try {
    const parentPath = Path.parent(path)
    const parent = parentPath.length ? Node.get(editor, parentPath) as Element : editor
    const node = yNodeAtPath(editor, shared.field, parentPath)
    const position = Y.createRelativePositionFromTypeIndex(node, yOffset(parent, path[path.length - 1]), 0, shared.renderer ?? null)
    return position.item ?? undefined
  } catch {
    return undefined
  }
}

// The path of a block suggested whole: the outermost element its range covers
function blockPath(editor: Editor, change: SuggestedChange): Path {
  const common = Path.common(change.range.anchor.path, change.range.focus.path)
  for (let length = 1; length <= common.length; length++) {
    const path = common.slice(0, length)
    if (Element.isElement(Node.get(editor, path)) && blockSuggestion(editor, diffRendererOf(editor)!, path)) {
      return path
    }
  }
  return Path.parent(change.range.anchor.path)
}

// The item a change starts at: the block's own for a whole block, else the
// first character's
function itemOf(editor: Editor, change: SuggestedChange): Y.ID | undefined {
  const shared = sharedOf(editor)
  if (!shared) {
    return undefined
  }
  if (change.block) {
    return blockItem(editor, blockPath(editor, change))
  }
  try {
    const leafPath = change.range.anchor.path
    const parentPath = Path.parent(leafPath)
    const parent = Node.get(editor, parentPath) as Element
    const node = yNodeAtPath(editor, shared.field, parentPath)
    const index = yOffset(parent, leafPath[leafPath.length - 1]) + change.range.anchor.offset
    return Y.createRelativePositionFromTypeIndex(node, index, 0, shared.renderer ?? null).item ?? undefined
  } catch {
    return undefined
  }
}
