import { Editor, Element, Node, Text, Transforms, type Descendant, type Path } from 'slate'
import { hashNode } from '../utils/hashNode'
import { diffWords, type TextChange } from '../utils/diffWords'
import { suggestionStore } from './store'
import type { SuggestedBlock, Suggestion } from './types'

/**
 * The suggestion that would turn one version of a document into another,
 * block by block: blocks changed, deleted and inserted, by id. Null when
 * nothing differs. Moving a block is not something it can tell.
 */
export function suggestionFor(
  before: Descendant[],
  after: Descendant[],
  author: Suggestion['author']
): Suggestion | null {
  const was = new Map(before.flatMap((node) => Element.isElement(node) && typeof node.id === 'string' ? [[node.id, node]] : []))
  const now = new Set(after.flatMap((node) => Element.isElement(node) && typeof node.id === 'string' ? [node.id] : []))
  const blocks: SuggestedBlock[] = []

  let previous: string | null = null
  for (const node of after) {
    if (!Element.isElement(node) || typeof node.id !== 'string') {
      continue
    }
    const old = was.get(node.id)
    if (!old) {
      blocks.push({ kind: 'insert', id: node.id, after: previous, node: structuredClone(node) })
    } else if (hashNode(old) !== hashNode(node)) {
      blocks.push({ kind: 'change', id: node.id, before: hashNode(old), after: structuredClone(node) })
    }
    previous = node.id
  }
  for (const [id, node] of was) {
    if (!now.has(id)) {
      blocks.push({ kind: 'delete', id, before: hashNode(node) })
    }
  }

  return blocks.length
    ? { id: crypto.randomUUID(), author, createdAt: Date.now(), blocks }
    : null
}

export type ReviewResult = { ok: true } | { ok: false, reason: 'stale' | 'gone' }

/** Whether a suggested block can still be accepted as suggested */
export function suggestedBlockState(editor: Editor, suggestion: Suggestion, block: SuggestedBlock): 'ready' | 'stale' {
  if (block.kind === 'insert') {
    return anchorIndex(editor, suggestion, block) === undefined ? 'stale' : 'ready'
  }
  const index = topIndex(editor, block.id)
  return index !== undefined && hashNode(editor.children[index]) === block.before ? 'ready' : 'stale'
}

/**
 * Accept one block of a suggestion: the person's own edit, in their undo.
 * Refused when the block changed since it was suggested, or is gone.
 */
export function acceptSuggestedBlock(editor: Editor, suggestionId: string, blockId: string): ReviewResult {
  const store = suggestionStore(editor)
  const suggestion = store.get(suggestionId)
  const block = suggestion?.blocks.find((b) => b.id === blockId)
  if (!suggestion || !block) {
    return { ok: false, reason: 'gone' }
  }
  if (suggestedBlockState(editor, suggestion, block) === 'stale') {
    return { ok: false, reason: 'stale' }
  }

  Editor.withoutNormalizing(editor, () => {
    if (block.kind === 'insert') {
      Transforms.insertNodes(editor, structuredClone(block.node), { at: [anchorIndex(editor, suggestion, block)!] })
      return
    }
    const at: Path = [topIndex(editor, block.id)!]
    Transforms.removeNodes(editor, { at })
    if (block.kind === 'change') {
      Transforms.insertNodes(editor, structuredClone(block.after), { at })
    }
  })

  settle(editor, suggestionId, blockId)
  return { ok: true }
}

/** Reject one block of a suggestion: the document stays as it is */
export function rejectSuggestedBlock(editor: Editor, suggestionId: string, blockId: string): void {
  settle(editor, suggestionId, blockId)
}

/** Accept every block of a suggestion that can be; returns those that could not */
export function acceptSuggestion(editor: Editor, suggestionId: string): string[] {
  const suggestion = suggestionStore(editor).get(suggestionId)
  return (suggestion?.blocks ?? []).flatMap((block) => acceptSuggestedBlock(editor, suggestionId, block.id).ok ? [] : [block.id])
}

export function rejectSuggestion(editor: Editor, suggestionId: string): void {
  suggestionStore(editor).remove(suggestionId)
}

/**
 * What a suggested change does to each text of its block: by the id of the
 * text-holding element, its word changes placed in the text as it is now.
 * A text the suggestion takes away is all removed. `formatting` says the
 * suggestion also changes more than words: marks, properties or structure.
 */
export function suggestedTextChanges(current: Element, after: Element): { texts: Map<string, TextChange[]>, formatting: boolean } {
  const proposed = new Map(textElements(after).map((element) => [element.id as string, element]))
  const texts = new Map<string, TextChange[]>()

  for (const element of textElements(current)) {
    const id = element.id as string
    const now = Node.string(element)
    const then = proposed.get(id)
    const changes = then ? diffWords(now, Node.string(then)) : now ? [{ at: 0, from: 0, added: '', removed: now }] : []
    if (changes.length) {
      texts.set(id, changes)
    }
  }

  return { texts, formatting: hashNode(skeleton(current)) !== hashNode(skeleton(after)) }
}

/** Remove a settled block from its suggestion, and the suggestion once empty */
function settle(editor: Editor, suggestionId: string, blockId: string): void {
  const store = suggestionStore(editor)
  const suggestion = store.get(suggestionId)
  if (!suggestion) {
    return
  }
  const blocks = suggestion.blocks.filter((b) => b.id !== blockId)
  if (blocks.length) {
    store.put({ ...suggestion, blocks })
  } else {
    store.remove(suggestionId)
  }
}

/** Where an inserted block goes: after its anchor, through anchors not yet inserted */
function anchorIndex(editor: Editor, suggestion: Suggestion, block: Extract<SuggestedBlock, { kind: 'insert' }>): number | undefined {
  let anchor = block.after
  const seen = new Set<string>()
  while (anchor !== null) {
    const index = topIndex(editor, anchor)
    if (index !== undefined) {
      return index + 1
    }
    if (seen.has(anchor)) {
      return undefined
    }
    seen.add(anchor)
    const earlier = suggestion.blocks.find((b): b is Extract<SuggestedBlock, { kind: 'insert' }> => b.kind === 'insert' && b.id === anchor)
    if (!earlier) {
      return undefined
    }
    anchor = earlier.after
  }
  return 0
}

function topIndex(editor: Editor, id: string): number | undefined {
  const index = editor.children.findIndex((node) => Element.isElement(node) && node.id === id)
  return index < 0 ? undefined : index
}

function textElements(root: Element): Element[] {
  const found: Element[] = []
  const walk = (element: Element) => {
    if (typeof element.id === 'string' && element.children.some((child) => Text.isText(child)) && element.class !== 'inline') {
      found.push(element)
    }
    element.children.forEach((child) => Element.isElement(child) && walk(child))
  }
  walk(root)
  return found
}

/** The block with its words taken out: two differ in it only if more than words differ */
function skeleton(node: Descendant): unknown {
  return Text.isText(node)
    ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'text'))
    : { ...node, children: node.children.map(skeleton) }
}
