import { describe, test, expect } from 'vitest'
import { render, act } from '@testing-library/react'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { slateNodesToInsertDelta } from '@slate-yjs/core'
import type { Descendant } from 'slate'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { AGENT_PRESENCE_FIELD, type AgentPresenceState } from '../lib/types/agentPresence'

const paragraph = (id: string, text: string) =>
  ({ id, type: 'base/text', class: 'text', properties: {}, children: [{ text }] }) as Descendant

function shared() {
  const doc = new Y.Doc()
  const content = doc.get('content', Y.XmlText)
  content.applyDelta(slateNodesToInsertDelta([paragraph('a', 'First'), paragraph('b', 'Second')]))
  return { doc, content }
}

/** Another peer, an agent, with its presence */
function agentPeer(doc: Y.Doc, local: Awareness, presence: AgentPresenceState | null) {
  const remote = new Awareness(new Y.Doc())
  remote.setLocalStateField(AGENT_PRESENCE_FIELD, presence)
  applyAwarenessUpdate(local, encodeAwarenessUpdate(remote, [remote.clientID]), 'test')
  return remote
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('agents in the document', () => {
  test('a block an agent writes in is marked with its name, read-only too', async () => {
    for (const readOnly of [false, true]) {
      const { doc, content } = shared()
      const awareness = new Awareness(doc)
      const { container, unmount } = render(
        <TextbitRoot value={content} awareness={awareness} readOnly={readOnly} cursor={{ data: { name: 'Me', color: 'red', initials: 'M' } }}>
          <TextbitEditable />
        </TextbitRoot>
      )
      await settle()

      await act(async () => {
        agentPeer(doc, awareness, { name: 'Assistant', color: 'rgb(0, 128, 0)', status: 'writing', blocks: ['b'] })
      })
      await settle()

      const markers = container.querySelectorAll('[data-tb="agent-marker"]')
      expect(markers).toHaveLength(1)
      expect(markers[0].closest('[data-id]')?.getAttribute('data-id')).toBe('b')
      expect(markers[0].textContent).toBe('Assistant is writing')
      expect(markers[0].getAttribute('aria-hidden')).toBe('true')
      unmount()
    }
  })

  test('nothing is marked when the agent is idle, or names no block', async () => {
    const { doc, content } = shared()
    const awareness = new Awareness(doc)
    const { container } = render(
      <TextbitRoot value={content} awareness={awareness}><TextbitEditable /></TextbitRoot>
    )
    await settle()
    await act(async () => {
      agentPeer(doc, awareness, { name: 'A', status: 'idle', blocks: ['a'] })
      agentPeer(doc, awareness, { name: 'B', status: 'thinking', blocks: [] })
    })
    await settle()
    expect(container.querySelectorAll('[data-tb="agent-marker"]')).toHaveLength(0)
  })
})
