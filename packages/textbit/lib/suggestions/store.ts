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
    return sharedStore(doc.getMap<Suggestion>(SUGGESTIONS_MAP), (change) => doc.transact(change, YjsEditor.origin(editor)))
  }
  let store = MEMORY.get(editor)
  if (!store) {
    store = memoryStore()
    MEMORY.set(editor, store)
  }
  return store
}

function sharedStore(map: Y.Map<Suggestion>, transact: (change: () => void) => void): SuggestionStore {
  return {
    list: () => [...map.values()].sort((a, b) => a.createdAt - b.createdAt),
    get: (id) => map.get(id),
    put: (suggestion) => transact(() => map.set(suggestion.id, structuredClone(suggestion))),
    remove: (id) => transact(() => map.delete(id)),
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
