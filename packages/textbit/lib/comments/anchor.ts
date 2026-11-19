// Anchors: a range of text as something that survives edits, and back. A
// shared editor stores Y.js relative positions, which follow the text; every
// editor also stores the quote within its block, which serves where positions
// cannot, such as a document restored from JSON.
import * as Y from '@y/y'
import { Editor, Element, Node, Point, Range, Text, type Path } from 'slate'
import { sharedOf } from '../yjs/binding'
import { pointToRelativePosition, relativePositionToPoint } from '../yjs/positions'
import type { CommentAnchor } from './types'

/** How much text either side of a quote is kept to tell occurrences apart */
const CONTEXT = 32

/**
 * A range of an editor as a comment anchor; nothing for a collapsed range or
 * one outside the text
 */
export function commentAnchor(editor: Editor, range: Range): CommentAnchor | undefined {
  if (Range.isCollapsed(range)) {
    return undefined
  }
  const [start, end] = Range.edges(range)
  let quote: string
  try {
    quote = Editor.string(editor, { anchor: start, focus: end })
  } catch {
    return undefined
  }
  if (!quote) {
    return undefined
  }

  const anchor: CommentAnchor = { quote }
  const block = blockAt(editor, start)
  if (block) {
    const [node, path] = block
    const text = Node.string(node)
    const offset = Editor.string(editor, { anchor: Editor.start(editor, path), focus: start }).length
    anchor.block = node.id as string
    anchor.offset = offset
    anchor.prefix = text.slice(Math.max(0, offset - CONTEXT), offset)
    if (text.slice(offset, offset + quote.length) === quote) {
      anchor.suffix = text.slice(offset + quote.length, offset + quote.length + CONTEXT)
    }
  }

  // Typing at either edge stays outside the range: the start sticks to the
  // character after it, the end to the one before
  const startPosition = pointToRelativePosition(editor, start, 0)
  const endPosition = pointToRelativePosition(editor, end, -1)
  if (startPosition && endPosition) {
    anchor.start = toBase64(Y.encodeRelativePosition(startPosition))
    anchor.end = toBase64(Y.encodeRelativePosition(endPosition))
  }
  return anchor
}

/**
 * Where an anchor is in an editor now; nothing when its text is gone, so the
 * comment is detached. Relative positions first, where the editor is shared;
 * then the quote, within its block.
 */
export function resolveAnchor(editor: Editor, anchor: CommentAnchor): Range | undefined {
  if (anchor.start && anchor.end && sharedOf(editor)) {
    const start = toPoint(editor, anchor.start)
    const end = toPoint(editor, anchor.end)
    if (start && end) {
      const range = { anchor: start, focus: end }
      // Found, but everything in it deleted: detached, not somewhere else
      return Point.compare(start, end) >= 0 ? undefined : range
    }
  }
  return findQuote(editor, anchor)
}

function toPoint(editor: Editor, encoded: string): Point | undefined {
  try {
    return relativePositionToPoint(editor, Y.decodeRelativePosition(fromBase64(encoded)))
  } catch {
    return undefined
  }
}

// The quote in its block: the occurrence with the same text around it, or
// the one nearest where it was. With the text around it known, one side at
// least must still match: another occurrence elsewhere is other text, and a
// comment never moves to it.
function findQuote(editor: Editor, anchor: CommentAnchor): Range | undefined {
  if (!anchor.quote || !anchor.block) {
    return undefined
  }
  const [entry] = Editor.nodes(editor, {
    at: [],
    match: (n) => Element.isElement(n) && n.id === anchor.block
  })
  if (!entry) {
    return undefined
  }
  const [block, path] = entry
  const text = Node.string(block)
  const found: number[] = []
  for (let at = text.indexOf(anchor.quote); at !== -1; at = text.indexOf(anchor.quote, at + 1)) {
    found.push(at)
  }
  if (!found.length) {
    return undefined
  }
  const wanted = anchor.offset ?? 0
  const sides = (at: number) => ({
    before: anchor.prefix !== undefined && text.slice(0, at).endsWith(anchor.prefix),
    after: anchor.suffix !== undefined && text.slice(at + anchor.quote.length).startsWith(anchor.suffix)
  })
  const score = (at: number) => {
    const { before, after } = sides(at)
    return (before ? 0 : 1) + (after ? 0 : 1)
  }
  const context = anchor.prefix !== undefined || anchor.suffix !== undefined
  const candidates = context ? found.filter((at) => sides(at).before || sides(at).after) : found
  if (!candidates.length) {
    return undefined
  }
  const best = candidates.reduce((a, b) => {
    const order = score(a) - score(b)
    return order < 0 || (order === 0 && Math.abs(a - wanted) <= Math.abs(b - wanted)) ? a : b
  })
  const start = pointAtOffset(block as Element, path, best)
  const end = pointAtOffset(block as Element, path, best + anchor.quote.length)
  return start && end ? { anchor: start, focus: end } : undefined
}

// The lowest element with an id around a point: the block a quote is kept in
function blockAt(editor: Editor, point: Point) {
  const [entry] = Editor.nodes(editor, {
    at: point,
    mode: 'lowest',
    match: (n) => Element.isElement(n) && typeof n.id === 'string' && !Editor.isInline(editor, n)
  })
  return entry as [Element, Path] | undefined
}

// A point some characters into an element's text
function pointAtOffset(element: Element, path: Path, offset: number): Point | undefined {
  let start = 0
  let last: Point | undefined
  for (const [text, relative] of Node.texts(element)) {
    const length = (text as Text).text.length
    if (offset <= start + length) {
      return { path: [...path, ...relative], offset: offset - start }
    }
    start += length
    last = { path: [...path, ...relative], offset: length }
  }
  return offset === start ? last : undefined
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
