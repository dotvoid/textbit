import { AGENT_PRESENCE_FIELD, type AgentPresenceState, type AgentStatus } from '@dotvoid/textbit/headless'

/** What presence needs of a Y.js awareness: setting a field of the local state */
export interface AwarenessLike {
  setLocalStateField(field: string, value: unknown): void
}

export interface AgentPresence {
  /** Say what the agent does now, and on which top-level elements, by id */
  set(status: AgentStatus, blocks?: string[]): void
  /** Leave: nothing is shown any more */
  clear(): void
}

/**
 * The agent's presence in a shared document, as editors show it: its name and
 * colour on the blocks it works on. Pass the awareness of the agent's own
 * connection to the document. A document agent given it keeps it up to date:
 * reading, writing, and the blocks it changes.
 */
export function createAgentPresence(awareness: AwarenessLike, identity: { name: string, color?: string }): AgentPresence {
  let last = ''
  const publish = (state: AgentPresenceState | null) => {
    const next = JSON.stringify(state)
    if (next !== last) {
      last = next
      awareness.setLocalStateField(AGENT_PRESENCE_FIELD, state)
    }
  }

  return {
    set: (status, blocks = []) => publish({
      name: identity.name,
      ...(identity.color ? { color: identity.color } : {}),
      status,
      blocks: status === 'idle' ? [] : blocks
    }),
    clear: () => publish(null)
  }
}
