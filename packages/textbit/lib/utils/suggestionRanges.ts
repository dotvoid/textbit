import { Editor, Element, Node, Path, Text, type Range } from 'slate'
import type { ShownSuggestion } from '../contexts/SuggestionsContext'

/**
 * Decoration pieces showing suggestions in one text node: text a suggestion
 * removes, struck through, and text it adds, shown beside where it goes. A
 * block a suggestion deletes is struck through whole.
 */
export function suggestionRanges(editor: Editor, onBlock: ReadonlyMap<string, ShownSuggestion>, node: Text, path: Path): Range[] {
  const top = editor.children[path[0]]
  const shown = Element.isElement(top) && typeof top.id === 'string' ? onBlock.get(top.id) : undefined
  if (!shown) {
    return []
  }
  const color = shown.suggestion.author.color ?? ''
  const stale = shown.state === 'stale'

  if (shown.block.kind === 'delete') {
    return node.text.length
      ? [{ anchor: { path, offset: 0 }, focus: { path, offset: node.text.length }, suggestDelete: true, suggestColor: color, ...(stale ? { suggestStale: true } : {}) }]
      : []
  }

  // The text-holding element this text is in, and where in its text this node starts
  const [entry] = Editor.nodes(editor, {
    at: path,
    match: (n) => Element.isElement(n) && typeof n.id === 'string' && !Editor.isInline(editor, n) && n.children.some((c) => Text.isText(c)),
    mode: 'lowest'
  })
  if (!entry) {
    return []
  }
  const [element, elementPath] = entry as [Element, Path]
  const changes = shown.texts?.get(element.id as string)
  if (!changes?.length) {
    return []
  }

  let start = 0
  for (const [text, textPath] of Node.texts(element)) {
    if (Path.equals([...elementPath, ...textPath], path)) {
      break
    }
    start += text.text.length
  }
  const end = start + node.text.length
  const total = Node.string(element).length
  const ranges: Range[] = []
  const mark = { suggestColor: color, ...(stale ? { suggestStale: true } : {}) }

  for (const change of changes) {
    const removedEnd = change.from + change.removed.length
    if (change.removed && change.from < end && removedEnd > start) {
      ranges.push({
        anchor: { path, offset: Math.max(change.from, start) - start },
        focus: { path, offset: Math.min(removedEnd, end) - start },
        suggestDelete: true,
        ...mark
      })
    }
    if (!change.added) {
      continue
    }
    // New text shows on the character after what it replaces or where it goes,
    // which is not struck through, or after the last at the end of the text
    const place = change.removed ? removedEnd : change.from
    const [char, at] = place < total ? [place, 'before' as const] : [place - 1, 'after' as const]
    if (char >= start && char < end) {
      ranges.push({
        anchor: { path, offset: char - start },
        focus: { path, offset: char - start + 1 },
        suggestInsert: change.added,
        suggestInsertAt: at,
        ...(change.removed ? { suggestReplaces: true } : {}),
        ...mark
      })
    }
  }
  return ranges
}
