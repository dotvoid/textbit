import type { Editor } from 'slate'
import type { PluginInitFunction } from '../../types'

type Target = 'toolbar' | 'gutter'

// Toolbars mounted in each editor, keyed by editor. The action only has the
// editor, so this is how it reaches the toolbar the host placed there.
const targets = new WeakMap<Editor, Map<Target, () => boolean>>()

/** Register what focusing a toolbar means in this editor. Returns the unregister. */
export function registerToolbarFocus(editor: Editor, target: Target, focus: () => boolean): () => void {
  const map = targets.get(editor) ?? new Map<Target, () => boolean>()
  map.set(target, focus)
  targets.set(editor, map)
  return () => {
    if (map.get(target) === focus) {
      map.delete(target)
    }
  }
}

/**
 * Move focus to the formatting toolbar, or to the gutter menu button when the
 * toolbar is hidden. Returns false when neither can take focus.
 */
export function focusToolbar(editor: Editor): boolean {
  const map = targets.get(editor)
  return !!(map?.get('toolbar')?.() || map?.get('gutter')?.())
}

export type FocusToolbarOptions = {
  /**
   * Defaults to Alt+F10 (Option+F10 on macOS), the toolbar key in other web
   * editors. `false` removes it.
   */
  hotkey?: string | false
}

/**
 * Keyboard access to the toolbar. Registered by default; register it again with
 * other options to change or remove the key - plugins are replaced by name.
 */
export const FocusToolbar: PluginInitFunction<FocusToolbarOptions> = (options) => {
  return {
    class: 'generic',
    name: 'core/toolbar',
    actions: [
      {
        name: 'focus',
        title: 'Go to toolbar',
        hotkey: options?.hotkey === false ? undefined : options?.hotkey ?? 'alt+f10',
        handler: ({ editor, event }) => {
          if (focusToolbar(editor)) {
            event?.preventDefault()
          }
        }
      }
    ]
  }
}
