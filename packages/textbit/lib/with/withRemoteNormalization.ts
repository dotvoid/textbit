import type { Editor } from 'slate'
import type { YjsEditor } from '@slate-yjs/core'

const APPLYING = new WeakSet<Editor>()

/**
 * Leave the shared document's content to the peer that wrote it.
 *
 * `@slate-yjs/core` normalizes remote changes, and the whole document when it
 * connects, as local changes, so every connected peer writes its own repair
 * into the shared document. Repairs that insert do not merge: two peers adding
 * a missing field give two fields. While this editor applies the shared state,
 * the plugins' constraints and normalizers are therefore skipped. A change is
 * repaired by the peer that makes it, which is also how content that arrives
 * invalid gets repaired: when someone here edits it.
 *
 * Slate's own normalization still runs, as the editor depends on it.
 */
export function withRemoteNormalization<T extends Editor & YjsEditor>(editor: T): T {
  const { applyRemoteEvents, connect } = editor

  editor.applyRemoteEvents = (events, origin) => {
    applying(editor, () => applyRemoteEvents(events, origin))
  }

  editor.connect = () => {
    applying(editor, connect)
  }

  return editor
}

/** Whether the editor is applying the shared document's state */
export function isApplyingRemote(editor: Editor): boolean {
  return APPLYING.has(editor)
}

function applying(editor: Editor, fn: () => void): void {
  if (APPLYING.has(editor)) {
    fn()
    return
  }

  APPLYING.add(editor)
  try {
    fn()
  } finally {
    APPLYING.delete(editor)
  }
}
