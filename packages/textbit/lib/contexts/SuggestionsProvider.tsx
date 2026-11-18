import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Element, type Editor } from 'slate'
import { useSlateSelector, useSlateStatic } from 'slate-react'
import { SuggestionsContext, type ShownSuggestion } from './SuggestionsContext'
import { suggestionStore } from '../suggestions/store'
import {
  acceptSuggestedBlock, acceptSuggestion, rejectSuggestedBlock, rejectSuggestion,
  suggestedBlockState, suggestedTextChanges
} from '../suggestions/review'
import type { SuggestedBlock, Suggestion } from '../suggestions/types'

/**
 * The suggestions of the document, and where each block of them shows: again
 * whenever they or the document change
 */
export function SuggestionsProvider({ children }: { children: ReactNode }) {
  const editor = useSlateStatic()
  const document = useSlateSelector((e) => e.children)
  const [suggestions, setSuggestions] = useState<Suggestion[]>(() => suggestionStore(editor).list())

  useEffect(() => {
    const store = suggestionStore(editor)
    const update = () => setSuggestions(store.list())
    update()
    return store.subscribe(update)
  }, [editor])

  const { onBlock, after } = useMemo(
    () => placed(editor, suggestions),
    // The document is a dependency: what is stale and where inserts go follow it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, suggestions, document]
  )

  const accept = useCallback((suggestionId: string, blockId?: string) => {
    if (blockId) {
      acceptSuggestedBlock(editor, suggestionId, blockId)
    } else {
      acceptSuggestion(editor, suggestionId)
    }
  }, [editor])

  const reject = useCallback((suggestionId: string, blockId?: string) => {
    if (blockId) {
      rejectSuggestedBlock(editor, suggestionId, blockId)
    } else {
      rejectSuggestion(editor, suggestionId)
    }
  }, [editor])

  const shown = useMemo(() => inOrder(editor, onBlock, after), [editor, onBlock, after])
  const value = useMemo(() => ({ suggestions, shown, onBlock, after, accept, reject }), [suggestions, shown, onBlock, after, accept, reject])
  return <SuggestionsContext.Provider value={value}>{children}</SuggestionsContext.Provider>
}

function placed(editor: Editor, suggestions: Suggestion[]) {
  const onBlock = new Map<string, ShownSuggestion>()
  const after = new Map<string, ShownSuggestion[]>()
  const live = new Map(editor.children.flatMap((node) => Element.isElement(node) && typeof node.id === 'string' ? [[node.id, node]] : []))

  for (const suggestion of suggestions) {
    for (const block of suggestion.blocks) {
      const state = suggestedBlockState(editor, suggestion, block)
      if (block.kind === 'insert') {
        const anchor = liveAnchor(suggestion, block, live) ?? ''
        after.set(anchor, [...after.get(anchor) ?? [], { suggestion, block, state, node: block.node }])
        continue
      }
      const current = live.get(block.id)
      if (!current || onBlock.has(block.id)) {
        // Gone, or another suggestion shows here first
        continue
      }
      onBlock.set(block.id, block.kind === 'change'
        ? { suggestion, block, state, ...suggestedTextChanges(current, block.after) }
        : { suggestion, block, state })
    }
  }
  return { onBlock, after }
}

/** Every shown block in document order: inserts at the start, then each block and what follows it */
function inOrder(editor: Editor, onBlock: Map<string, ShownSuggestion>, after: Map<string, ShownSuggestion[]>): ShownSuggestion[] {
  const ordered = [...after.get('') ?? []]
  for (const node of editor.children) {
    if (Element.isElement(node) && typeof node.id === 'string') {
      const here = onBlock.get(node.id)
      ordered.push(...here ? [here] : [], ...after.get(node.id) ?? [])
    }
  }
  return ordered
}

/** The block an inserted one shows after: its anchor, or the anchor's, until one is in the document */
function liveAnchor(suggestion: Suggestion, block: Extract<SuggestedBlock, { kind: 'insert' }>, live: Map<string, Element>): string | null {
  let anchor = block.after
  const seen = new Set<string>()
  while (anchor !== null && !live.has(anchor) && !seen.has(anchor)) {
    seen.add(anchor)
    const earlier = suggestion.blocks.find((b) => b.kind === 'insert' && b.id === anchor)
    anchor = earlier?.kind === 'insert' ? earlier.after : null
  }
  return anchor !== null && live.has(anchor) ? anchor : null
}
