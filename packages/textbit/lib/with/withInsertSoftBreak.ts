import {
  Editor,
  Element as SlateElement,
  Range,
  Transforms
} from 'slate'
import { type PluginRegistryComponent } from '../contexts/PluginRegistry/lib/types'

/**
 * Handle Shift+Enter as a soft break: insert a `\n` character into the current
 * text leaf. Slate's default `insertSoftBreak` splits the node instead (same
 * behaviour as `insertBreak`), which is rarely what users expect from
 * Shift+Enter in a prose editor.
 *
 * The action is gated by the `allowSoftBreak` constraint on the plugins in
 * the cursor's ancestor chain:
 *
 * - Any explicit `allowSoftBreak: false` in the chain forbids the break
 *   (a "deny wins" ancestor policy).
 * - At least one explicit `allowSoftBreak: true` in the chain is required
 *   to allow it (opt-in per plugin — the default of an unset value is deny).
 *
 * When forbidden, `insertSoftBreak` is a silent no-op — matching the rest of
 * the editor's blocked-action guards. The user's Shift+Enter has no visible
 * effect rather than falling back to a paragraph split.
 */
export function withInsertSoftBreak(editor: Editor, components: Map<string, PluginRegistryComponent>) {
  editor.insertSoftBreak = () => {
    if (!allowSoftBreak(editor, components)) {
      return
    }

    Transforms.insertText(editor, '\n')
  }

  return editor
}

/**
 * Walk the ancestor chain of each selection endpoint. Any explicit
 * `allowSoftBreak: false` denies. If nothing on the chain explicitly opts in
 * with `true`, denies too. Both endpoints must satisfy independently.
 */
function allowSoftBreak(
  editor: Editor,
  components: Map<string, PluginRegistryComponent>
): boolean {
  const { selection } = editor
  if (!selection) return false

  const points = Range.isCollapsed(selection)
    ? [selection.anchor]
    : [selection.anchor, selection.focus]

  for (const point of points) {
    let hasOptIn = false

    for (const [node] of Editor.levels(editor, { at: point })) {
      if (!SlateElement.isElement(node)) continue

      const component = components.get(node.type)
      if (!component) continue

      const setting = component.componentEntry?.constraints?.allowSoftBreak
      if (setting === false) return false
      if (setting === true) hasOptIn = true
    }

    if (!hasOptIn) return false
  }

  return true
}
