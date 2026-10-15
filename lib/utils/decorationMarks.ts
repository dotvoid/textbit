import { Range, type Path, type Text } from 'slate'
import type { Decoration } from '../types'

const MARK_PREFIX = 'tbMark:'

/**
 * Leaf/range property key for a decoration id. One key per id, so overlapping
 * decorations keep every id when Slate merges range props into a leaf.
 */
export function markKey(id: string): `tbMark:${string}` {
  return `${MARK_PREFIX}${id}`
}

/**
 * Pieces of the given decorations that fall inside one text node, each carrying
 * its mark key. Collapsed and non-intersecting pieces are skipped.
 */
export function getDecorationMarkRanges(
  decorations: readonly Decoration[],
  path: Path,
  textLength: number
): Range[] {
  const textRange: Range = {
    anchor: { path, offset: 0 },
    focus: { path, offset: textLength }
  }
  const ranges: Range[] = []

  for (const { id, range } of decorations) {
    const piece = Range.intersection(range, textRange)
    if (!piece || Range.isCollapsed(piece)) {
      continue
    }

    const [start, end] = Range.edges(piece)
    ranges.push({ anchor: start, focus: end, [markKey(id)]: id })
  }

  return ranges
}

/**
 * Decoration ids carried by a leaf, sorted so the rendered attribute is stable.
 */
export function getLeafMarkIds(leaf: Text): string[] {
  const ids: string[] = []

  for (const key of Object.keys(leaf)) {
    const value = leaf[key]
    if (key.startsWith(MARK_PREFIX) && typeof value === 'string') {
      ids.push(value)
    }
  }

  return ids.sort()
}
