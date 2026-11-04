import type { Editor } from 'slate'

// Pickers mounted in each editor. The open action only has the editor, so this
// is how it reaches the picker that the host placed in that editor.
const listeners = new WeakMap<Editor, Set<() => void>>()

export const SPECIAL_CHARACTERS_PLUGIN = 'core/specialchars'

/** Open the picker in this editor. Returns false when no picker is mounted. */
export function openSpecialCharacters(editor: Editor): boolean {
  const set = listeners.get(editor)
  if (!set?.size) {
    return false
  }

  set.forEach((listener) => listener())
  return true
}

export function onOpenSpecialCharacters(editor: Editor, listener: () => void): () => void {
  const set = listeners.get(editor) ?? new Set()
  set.add(listener)
  listeners.set(editor, set)
  return () => {
    set.delete(listener)
  }
}
