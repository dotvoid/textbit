// Places in a shared text field that follow the text: Slate points as Y.js
// relative positions, and back. A relative position names the text it is in,
// so one made in one editor can be found, or not, in any other.
import * as Y from '@y/y'
import { Element, Node, Path, Text, type Editor, type Point, type Range } from 'slate'
import { sharedOf, yNodeAtPath } from './binding'
import { yLength, yOffset } from './model'

/**
 * A point of an editor bound to a text field as a Y.js relative position.
 * Nothing when the editor is not bound or the point is not in the document.
 *
 * @param assoc Which character the position sticks to: `0` the one after it
 * (default), `-1` the one before
 */
export function pointToRelativePosition(editor: Editor, point: Point, assoc = 0): Y.RelativePosition | undefined {
  const shared = sharedOf(editor)
  if (!shared || !Node.has(editor, point.path)) {
    return undefined
  }
  const leaf = Node.get(editor, point.path)
  if (!Text.isText(leaf)) {
    return undefined
  }
  const parentPath = Path.parent(point.path)
  const parent = parentPath.length ? (Node.get(editor, parentPath) as Element) : editor
  try {
    const node = yNodeAtPath(editor, shared.field, parentPath)
    const offset = yOffset(parent, point.path[point.path.length - 1]) + point.offset
    // Through the editor's renderer, offsets count what it shows, such as
    // suggested deletions
    return Y.createRelativePositionFromTypeIndex(node, offset, assoc, shared.renderer ?? null)
  } catch {
    return undefined
  }
}

/** A Y.js relative position as a point of an editor, if it is in the editor's text field */
export function relativePositionToPoint(editor: Editor, position: Y.RelativePosition): Point | undefined {
  const shared = sharedOf(editor)
  const doc = shared?.field.doc
  if (!shared || !doc) {
    return undefined
  }
  const absolute = Y.createAbsolutePositionFromRelativePosition(position, doc, false, shared.renderer ?? null)
  if (!absolute || !(absolute.type instanceof Y.Node)) {
    return undefined
  }
  const path = pathOf(editor, shared.field, absolute.type)
  if (!path) {
    return undefined
  }
  const element = path.length ? Node.get(editor, path) : editor
  if (!Element.isElement(element) && path.length) {
    return undefined
  }
  return pointIn(path, (element as { children: Node[] }).children as Element['children'], absolute.index)
}

/** A range as relative positions, for awareness and anything that should follow the text */
export function rangeToRelativePositions(editor: Editor, range: Range) {
  const anchor = pointToRelativePosition(editor, range.anchor)
  const focus = pointToRelativePosition(editor, range.focus)
  return anchor && focus ? { anchor, focus } : undefined
}

/** Relative positions as a range of the editor, if both are in its field */
export function relativePositionsToRange(
  editor: Editor,
  positions: { anchor: Y.RelativePosition, focus: Y.RelativePosition }
): Range | undefined {
  const anchor = relativePositionToPoint(editor, positions.anchor)
  const focus = relativePositionToPoint(editor, positions.focus)
  return anchor && focus ? { anchor, focus } : undefined
}

// The Slate path of a Y.js node in the field, walking up to the field
function pathOf(editor: Editor, field: Y.Node, node: Y.Node): Path | undefined {
  const chain: Y.Node[] = []
  let current: Y.Node | null = node
  while (current && current !== field) {
    chain.unshift(current)
    current = current.parent
  }
  if (current !== field) {
    return undefined // not in this field
  }
  const path: Path = []
  let parent: Y.Node = field
  let slate: { children: Node[] } = editor
  for (const child of chain) {
    const offset = offsetOf(parent, child)
    if (offset === undefined) {
      return undefined
    }
    const index = indexAtOffset(slate.children as Element['children'], offset)
    if (index === undefined) {
      return undefined
    }
    path.push(index)
    parent = child
    slate = slate.children[index] as Element
  }
  return path
}

function offsetOf(parent: Y.Node, child: Y.Node): number | undefined {
  for (let i = 0; i < parent.length; i++) {
    if (parent.get(i) === child) {
      return i
    }
  }
  return undefined
}

// The Slate child that starts at a Y.js offset and is an element
function indexAtOffset(children: Element['children'], offset: number): number | undefined {
  let start = 0
  for (let i = 0; i < children.length; i++) {
    if (start === offset && !Text.isText(children[i])) {
      return i
    }
    start += yLength(children[i])
  }
  return undefined
}

function pointIn(path: Path, children: Element['children'], offset: number): Point | undefined {
  let start = 0
  let last: Point | undefined
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (Text.isText(child)) {
      if (offset <= start + child.text.length) {
        return { path: path.concat(i), offset: offset - start }
      }
      last = { path: path.concat(i), offset: child.text.length }
    }
    start += yLength(child)
  }
  return last
}
