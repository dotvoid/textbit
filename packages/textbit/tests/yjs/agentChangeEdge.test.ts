// @vitest-environment node
// An agent's change that starts where one piece of text ends and the next begins
import { describe, expect, test } from 'vitest'
import * as Y from '@y/y'
import type { Element } from 'slate'
import { createTextbitEditor } from '../../lib/editor/createTextbitEditor'
import { pointToRelativePosition, seedField } from '../../lib/yjs'
import { agentChangeRanges, resolveAgentChanges } from '../../lib/utils/agentChanges'

describe('an agent change starting at a mark', () => {
  test('carries the agent’s name and what it removed on its first piece', () => {
    const doc = new Y.Doc()
    const field = doc.get('body')
    seedField(field, [{
      id: 'p', type: 'base/text', class: 'text',
      children: [{ text: 'Hello ' }, { text: 'world', bold: true }]
    } as Element])
    const editor = createTextbitEditor({ shared: field })
    const bytes = (path: number[], offset: number, assoc: number) =>
      Array.from(Y.encodeRelativePosition(pointToRelativePosition(editor, { path, offset }, assoc)!))
    const changes = resolveAgentChanges(editor, [{
      clientId: 1, name: 'Helper', status: 'idle', blocks: [],
      changes: [{ id: 'c', block: 'p', from: bytes([0, 1], 0, 0), to: bytes([0, 1], 5, -1), added: 'world', removed: 'earth' }]
    }], new Set())
    const text = (editor.children[0] as Element).children[1] as { text: string }
    const [piece] = agentChangeRanges(changes, [0, 1], text as never)
    expect(piece).toMatchObject({ agentName: 'Helper', agentRemoved: 'earth' })
  })
})
