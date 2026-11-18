import { Editor, Path, Range, Text, type Point } from 'slate'
import * as Y from 'yjs'
import { YjsEditor, relativePositionToSlatePoint } from '@slate-yjs/core'
import type { PresentAgent } from '../contexts/AgentPresenceContext'

/** An agent's change where it now is in this editor's document */
export interface ResolvedAgentChange {
  id: string
  name: string
  color?: string
  block: string
  /** The new text; collapsed where text was only removed */
  range: Range
  added?: string
  removed?: string
}

/**
 * The agents' changes that still stand in the document: their ranges resolved
 * from Y.js relative positions, so they followed any typing around them. A
 * change whose text was edited since, by anyone, is no longer shown.
 */
export function resolveAgentChanges(editor: Editor, agents: PresentAgent[], dismissed: ReadonlySet<string>): ResolvedAgentChange[] {
  if (!YjsEditor.isYjsEditor(editor)) {
    return []
  }
  const resolved: ResolvedAgentChange[] = []

  for (const agent of agents) {
    for (const change of agent.changes ?? []) {
      if (dismissed.has(change.id)) {
        continue
      }
      const anchor = point(editor, change.from)
      const focus = point(editor, change.to)
      if (!anchor || !focus) {
        continue
      }
      const range = { anchor, focus }
      if ((change.added ?? '') !== safeString(editor, range)) {
        continue
      }
      resolved.push({
        id: change.id,
        name: agent.name,
        ...(agent.color ? { color: agent.color } : {}),
        block: change.block,
        range,
        ...(change.added ? { added: change.added } : {}),
        ...(change.removed ? { removed: change.removed } : {})
      })
    }
  }
  return resolved
}

/**
 * Decoration pieces of the changes within one text node: added text marked
 * with its change, and removed text on the character beside where it was
 */
export function agentChangeRanges(changes: readonly ResolvedAgentChange[], path: Path, text: Text): Range[] {
  const whole: Range = { anchor: { path, offset: 0 }, focus: { path, offset: text.text.length } }
  const ranges: Range[] = []

  for (const change of changes) {
    const [start] = Range.edges(change.range)
    const color = change.color ?? ''

    if (!Range.isCollapsed(change.range)) {
      const piece = Range.intersection(change.range, whole)
      if (piece && !Range.isCollapsed(piece)) {
        const [from, to] = Range.edges(piece)
        const first = Path.equals(from.path, start.path) && from.offset === start.offset
        ranges.push({
          anchor: from,
          focus: to,
          agentChange: change.id,
          agentColor: color,
          ...(first && change.removed ? { agentRemoved: change.removed, agentRemovedAt: 'before' as const } : {})
        })
      }
      continue
    }

    // Only removed: shown on the character after where it was, or before it
    // at the end of the text
    if (!change.removed || !Path.equals(start.path, path) || !text.text.length) {
      continue
    }
    const atEnd = start.offset >= text.text.length
    const at = atEnd ? start.offset - 1 : start.offset
    ranges.push({
      anchor: { path, offset: at },
      focus: { path, offset: at + 1 },
      agentColor: color,
      agentRemoved: change.removed,
      agentRemovedAt: atEnd ? 'after' : 'before'
    })
  }
  return ranges
}

function point(editor: Editor, bytes: number[]): Point | null {
  try {
    const position = Y.decodeRelativePosition(Uint8Array.from(bytes))
    return relativePositionToSlatePoint((editor as YjsEditor & Editor).sharedRoot, editor, position)
  } catch {
    return null
  }
}

function safeString(editor: Editor, range: Range): string {
  try {
    return Editor.string(editor, range)
  } catch {
    return '\u0000'
  }
}
