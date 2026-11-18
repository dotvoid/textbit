import type { Editor } from 'slate'
import { YjsEditor } from '@slate-yjs/core'
import type * as Y from 'yjs'
import type { Suggestion } from './types'

/** Where suggestions are kept in a shared document: a map of the same Y.Doc */
export const SUGGESTIONS_MAP = 'textbitSuggestions'

export interface SuggestionStore {
  list(): Suggestion[]
  get(id: string): Suggestion | undefined
  put(suggestion: Suggestion): void
  remove(id: string): void
  /** Called on every change, by anyone; returns the unsubscribe */
  subscribe(listener: () => void): () => void
}

const MEMORY = new WeakMap<Editor, SuggestionStore>()

/**
 * The suggestions of an editor's document. Shared through Y.js when the
 * editor is; otherwise kept in memory with the editor, for everything in the
 * same page.
 */
export function suggestionStore(editor: Editor): SuggestionStore {
  if (YjsEditor.isYjsEditor(editor) && editor.sharedRoot.doc) {
    const doc = editor.sharedRoot.doc
    // Written as this editor's own changes, so its undo can take them back
    return sharedStore(doc.getMap<SharedEntry>(SUGGESTIONS_MAP), (change) => doc.transact(change, YjsEditor.origin(editor)))
  }
  let store = MEMORY.get(editor)
  if (!store) {
    store = memoryStore()
    MEMORY.set(editor, store)
  }
  return store
}

/**
 * In a shared document each block of a suggestion is an entry of its own,
 * keyed by the suggestion's id and the block's. A decision removes just its
 * block's entry: two people deciding different blocks at once do not undo each
 * other, and undoing a decision brings back exactly that block.
 */
interface SharedEntry {
  id: string
  author: Suggestion['author']
  createdAt: number
  /** Where the block comes in its suggestion */
  order: number
  block: Suggestion['blocks'][number]
}

const SEPARATOR = '\u0000'
const keyOf = (suggestionId: string, blockId: string) => `${suggestionId}${SEPARATOR}${blockId}`

function sharedStore(map: Y.Map<SharedEntry>, transact: (change: () => void) => void): SuggestionStore {
  const all = (): Suggestion[] => {
    const grouped = new Map<string, SharedEntry[]>()
    for (const entry of map.values()) {
      grouped.set(entry.id, [...grouped.get(entry.id) ?? [], entry])
    }
    return [...grouped.values()]
      .map((entries) => {
        const [first] = entries
        return {
          id: first.id,
          author: first.author,
          createdAt: first.createdAt,
          blocks: entries.sort((x, y) => x.order - y.order).map((entry) => entry.block)
        }
      })
      .sort((a, b) => a.createdAt - b.createdAt)
  }
  const keysOf = (id: string) => [...map.keys()].filter((key) => key.startsWith(`${id}${SEPARATOR}`))

  return {
    list: all,
    get: (id) => all().find((suggestion) => suggestion.id === id),
    put: (suggestion) => transact(() => {
      const keep = new Set(suggestion.blocks.map((block) => keyOf(suggestion.id, block.id)))
      keysOf(suggestion.id).filter((key) => !keep.has(key)).forEach((key) => map.delete(key))
      suggestion.blocks.forEach((block, order) => {
        const key = keyOf(suggestion.id, block.id)
        // Blocks already there stay as they are: rewriting them would
        // overwrite what others did to them meanwhile
        if (!map.has(key)) {
          map.set(key, structuredClone({ id: suggestion.id, author: suggestion.author, createdAt: suggestion.createdAt, order, block }))
        }
      })
    }),
    remove: (id) => transact(() => keysOf(id).forEach((key) => map.delete(key))),
    subscribe: (listener) => {
      map.observe(listener)
      return () => map.unobserve(listener)
    }
  }
}

function memoryStore(): SuggestionStore {
  const suggestions = new Map<string, Suggestion>()
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach((listener) => listener())
  return {
    list: () => [...suggestions.values()].sort((a, b) => a.createdAt - b.createdAt),
    get: (id) => suggestions.get(id),
    put: (suggestion) => {
      suggestions.set(suggestion.id, structuredClone(suggestion))
      changed()
    },
    remove: (id) => {
      if (suggestions.delete(id)) {
        changed()
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
