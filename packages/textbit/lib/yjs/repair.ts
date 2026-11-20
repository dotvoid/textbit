// Repairs a shared text field by textbit's rules, for the one process that
// repairs a document: in y-quorum, the server holding it.
//
// Two people's changes can each be valid and still merge into a shape neither
// made. Y.js 14 cannot keep a node's content valid as it changes, as any
// remote update can break it again; what it has is the value, checked after
// the fact. So the field is read, put right with the same rules an editor
// applies to its own changes, and the repair written back as ordinary changes.
// Clients never do this on their own: two of them repairing the same thing at
// once duplicate or delete it.
import * as Y from '@y/y'
import { Editor, Node, Transforms } from 'slate'
import type { PluginDefinition } from '../types/textbit'
import { createTextbitEditor } from '../editor/createTextbitEditor'
import { hashNode } from '../utils/hashNode'
import { sharedOf } from './binding'

/** What `repairField` takes */
export interface TBRepairOptions {
  /** The field's plugins, as its editors have them */
  plugins?: PluginDefinition[]
  /** The origin of the repair's changes in Y.js transactions */
  origin?: object
}

/** How many rounds a repair may take before it gives up: rules that never settle */
const ROUNDS = 20

/**
 * Puts a text field right by textbit's rules: every element normalized as an
 * editor normalizes its own changes, and elements that share an id made
 * unique. Of elements with the same id the first in the field stays; a later
 * exact copy is removed (a block two people moved at once, as Y.js moves by
 * copying), a later one that differs gets an id of its own, so nothing anyone
 * wrote is lost. Writes only what it changes; returns whether it changed
 * anything.
 */
export function repairField(field: Y.Node, options: TBRepairOptions = {}): boolean {
  const editor = createTextbitEditor({
    shared: field,
    ...(options.plugins ? { plugins: options.plugins } : {}),
    ...(options.origin ? { origin: options.origin } : {})
  })
  let operations = 0
  const { apply } = editor
  editor.apply = (operation) => {
    if (operation.type !== 'set_selection') {
      operations++
    }
    apply(operation)
  }
  try {
    for (let round = 0; round < ROUNDS; round++) {
      const before = operations
      Editor.withoutNormalizing(editor, () => {
        while (makeIdsUnique(editor)) {
          // one at a time: paths move with each
        }
      })
      Editor.normalize(editor, { force: true })
      if (operations === before) {
        break
      }
    }
  } finally {
    editor.apply = apply
    sharedOf(editor)?.release()
  }
  return operations > 0
}

/** Puts right the first element whose id an earlier one has; returns whether there was one */
function makeIdsUnique(editor: Editor): boolean {
  const seen = new Map<string, string>()
  for (const [node, path] of Node.elements(editor)) {
    if (typeof node.id !== 'string') {
      continue
    }
    const hash = hashNode(node)
    const first = seen.get(node.id)
    if (first === undefined) {
      seen.set(node.id, hash)
      continue
    }
    if (first === hash) {
      // What held only the copy is then empty, and its own rules remove it
      Transforms.removeNodes(editor, { at: path })
    } else {
      Transforms.setNodes(editor, { id: crypto.randomUUID() }, { at: path })
    }
    return true
  }
  return false
}
