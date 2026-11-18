import { Editor, Element, Node, Text, type Path } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, slatePointToRelativePosition } from '@slate-yjs/core'
import type { TBAgentChange as AgentChange } from '@dotvoid/textbit/headless'
import { diffWords } from '@dotvoid/textbit/headless'
import { pointAt } from './edit'

/** The text of every text-holding element with an id, by id */
export function textsById(editor: Editor): Map<string, string> {
  const texts = new Map<string, string>()
  for (const [node] of textElements(editor, [])) {
    texts.set(node.id as string, Node.string(node))
  }
  return texts
}

/**
 * What an edit changed in the text of these top-level blocks, compared with
 * the texts before it, placed with Y.js relative positions. Only for an editor
 * on a shared document: elsewhere nobody else would see it.
 */
export function textChanges(editor: Editor, before: Map<string, string>, blocks: number[]): AgentChange[] {
  if (!YjsEditor.isYjsEditor(editor)) {
    return []
  }
  const shared = (editor as YjsEditor & Editor).sharedRoot
  const changes: AgentChange[] = []

  for (const index of blocks) {
    const top = editor.children[index]
    if (!Element.isElement(top) || typeof top.id !== 'string') {
      continue
    }
    for (const [element, path] of textElements(editor, [index])) {
      for (const change of diffWords(before.get(element.id as string) ?? '', Node.string(element))) {
        const from = pointAt(element, path, change.at, 'start')
        const to = pointAt(element, path, change.at + change.added.length, 'end')
        const encode = (point: typeof from) => Array.from(Y.encodeRelativePosition(slatePointToRelativePosition(shared, editor, point)))
        changes.push({
          id: crypto.randomUUID(),
          block: top.id,
          from: encode(from),
          to: change.added ? encode(to) : encode(from),
          ...(change.added ? { added: change.added } : {}),
          ...(change.removed ? { removed: change.removed } : {})
        })
      }
    }
  }
  return changes
}

/** Text-holding elements with ids: the element at a path and those under it, or all */
function* textElements(editor: Editor, at: Path): Generator<[Element, Path]> {
  const entries: [Node, Path][] = at.length
    ? [[Node.get(editor, at), at], ...[...Node.descendants(Node.get(editor, at))].map(([node, path]): [Node, Path] => [node, [...at, ...path]])]
    : [...Node.descendants(editor)]
  for (const [node, path] of entries) {
    if (Element.isElement(node) && typeof node.id === 'string' && !Editor.isInline(editor, node)
      && node.children.some((child) => Text.isText(child))) {
      yield [node, path]
    }
  }
}
