import type { PluginInitFunction } from '../../types'
import { isMac } from '../../utils/modifier'

// Non-breaking space (U+00A0). Sourced from its char code so the file stays
// ASCII and a literal NBSP is never confused with a regular space.
const NBSP = String.fromCharCode(0xa0)

// Word's shortcut. Not registered on macOS, where Option+Space already types a
// non-breaking space natively on the common layouts.
const HOTKEY = 'ctrl+shift+space'

// Registered action name, `<plugin>/<action>`
export const INSERT_NBSP_ACTION = 'core/nbsp/insert'

export const NonBreakingSpace: PluginInitFunction = () => {
  return {
    class: 'generic',
    name: 'core/nbsp',
    actions: [
      {
        name: 'insert',
        hotkey: isMac() ? undefined : HOTKEY,
        handler: ({ editor, event }) => {
          // Without this the browser may type a regular space as well
          event?.preventDefault()
          editor.insertText(NBSP)
        }
      }
    ]
  }
}
