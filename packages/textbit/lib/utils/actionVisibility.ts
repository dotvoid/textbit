import { type BaseSelection, Editor, Element } from 'slate'
import type { PluginRegistryAction } from '../contexts/PluginRegistry/lib/types'
import { TextbitElement } from './textbit-element'

type Offered = { action: PluginRegistryAction, enabled: boolean }

const HIDDEN: [boolean, boolean, boolean] = [false, false, false]

/**
 * An action's `[visible, enabled, active]` at the selection: its `visibility`
 * given the outermost element there and the innermost, where the caret is.
 * Hidden without a selection or without `visibility`.
 */
export function actionVisibility(
  editor: Editor,
  selection: BaseSelection,
  action: PluginRegistryAction
): [boolean, boolean, boolean] {
  if (!selection || !action.visibility) {
    return HIDDEN
  }

  const matches = Array.from(Editor.nodes(editor, {
    at: Editor.unhangRange(editor, selection),
    match: (el) => !Editor.isEditor(el) && Element.isElement(el)
  }))
  if (!matches.length) {
    return HIDDEN
  }

  const outerElement = matches[0][0]
  const innerElement = matches[matches.length - 1][0]
  if (!TextbitElement.isElement(outerElement)) {
    return HIDDEN
  }

  // The innermost element lets an action decide by where the caret is inside
  // nested blocks, such as a table cell
  const cursorElement = TextbitElement.isElement(innerElement) ? innerElement : undefined
  return action.visibility(outerElement, cursorElement) ?? HIDDEN
}

/** The action's title, or one made from its name: `base/bold/toggle-bold` -> `Toggle bold` */
export function actionTitle(action: Pick<PluginRegistryAction, 'name' | 'title'>): string {
  if (action.title) {
    return action.title
  }
  const text = (action.name.split('/').pop() ?? action.name).replace(/[-_]+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The plugins' actions marked `contextMenu` that are visible at the selection,
 * grouped by plugin. Empty where no plugin offers anything.
 */
export function contextMenuActions(
  editor: Editor,
  selection: BaseSelection,
  actions: PluginRegistryAction[]
): Offered[][] {
  const groups = new Map<string, Offered[]>()
  for (const action of actions) {
    if (!action.contextMenu) {
      continue
    }
    const [visible, enabled] = actionVisibility(editor, selection, action)
    if (visible) {
      const group = groups.get(action.plugin.name) ?? []
      group.push({ action, enabled })
      groups.set(action.plugin.name, group)
    }
  }
  return [...groups.values()]
}
