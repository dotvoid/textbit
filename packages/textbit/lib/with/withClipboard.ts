import type { Descendant, Editor } from 'slate'
import type { PluginRegistryComponent } from '../contexts/PluginRegistry/lib/types'
import {
  TEXTBIT_TYPES_FORMAT,
  clipboardFragment,
  convertUnregistered,
  decodeTextbitTypes
} from '../utils/clipboard'

/** The source editor's types for the paste in progress; null outside a paste */
const PASTE_SOURCE_TYPES = new WeakMap<Editor, Set<string> | null>()

/**
 * Copy and paste between editors that register different plugins.
 *
 * Copy, cut and drag write the fragment from `clipboardFragment`, and the
 * types this editor renders. Paste turns elements this editor cannot render
 * into text when the copying editor could render them, and leaves elements
 * that were already unknown there as they are. See utils/clipboard.ts.
 */
export function withClipboard(editor: Editor, components: Map<string, PluginRegistryComponent>) {
  const { setFragmentData, insertData, insertFragment } = editor

  editor.setFragmentData = (data, originEvent) => {
    const fragment = clipboardFragment(editor)

    // Slate writes the fragment it gets from getFragment twice: as its own
    // clipboard format and inside the HTML. Hand it ours for both, and keep
    // the HTML and plain text Slate writes.
    const { getFragment } = editor
    editor.getFragment = () => fragment
    try {
      setFragmentData(data, originEvent)
    } finally {
      editor.getFragment = getFragment
    }

    if (data.getData('application/x-slate-fragment')) {
      data.setData(TEXTBIT_TYPES_FORMAT, JSON.stringify([...components.keys()]))
    }
  }

  editor.insertData = (data) => {
    PASTE_SOURCE_TYPES.set(editor, decodeTextbitTypes(data))
    try {
      insertData(data)
    } finally {
      PASTE_SOURCE_TYPES.delete(editor)
    }
  }

  editor.insertFragment = (fragment, options) => {
    const sourceTypes = PASTE_SOURCE_TYPES.get(editor) ?? null
    const nodes = convertUnregistered(fragment as Descendant[], new Set(components.keys()), sourceTypes)
    if (nodes.length) {
      insertFragment(nodes, options)
    }
  }

  return editor
}
