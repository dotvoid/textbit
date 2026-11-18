import { AGENT_PRESENCE_FIELD, type AgentChange, type AgentPresenceState, type AgentStatus } from '@dotvoid/textbit/headless'

/** What presence needs of a Y.js awareness: setting a field of the local state */
export interface AwarenessLike {
  setLocalStateField(field: string, value: unknown): void
}

export interface AgentPresence {
  /** Say what the agent does now, and on which top-level elements, by id */
  set(status: AgentStatus, blocks?: string[]): void
  /** Show what it changed in the text, beside what it showed before */
  addChanges(changes: AgentChange[]): void
  /** Stop showing what it changed: at the start of a run, or after an undo */
  clearChanges(): void
  /** Leave: nothing is shown any more */
  clear(): void
  /** Who the agent is to people */
  readonly identity: { name: string, color?: string }
}

/**
 * The agent's presence in a shared document, as editors show it: its name and
 * colour on the blocks it works on. Pass the awareness of the agent's own
 * connection to the document. A document agent given it keeps it up to date:
 * reading, writing, and the blocks it changes.
 */
export function createAgentPresence(awareness: AwarenessLike, identity: { name: string, color?: string }): AgentPresence {
  // Nothing is shown until the agent says something
  let last = 'null'
  let status: AgentStatus = 'idle'
  let blocks: string[] = []
  let changes: AgentChange[] = []
  let present = false

  const publish = () => {
    const state: AgentPresenceState | null = present
      ? {
        name: identity.name,
        ...(identity.color ? { color: identity.color } : {}),
        status,
        blocks: status === 'idle' ? [] : blocks,
        ...(changes.length ? { changes } : {})
      }
      : null
    const next = JSON.stringify(state)
    if (next !== last) {
      last = next
      awareness.setLocalStateField(AGENT_PRESENCE_FIELD, state)
    }
  }

  return {
    identity,
    set: (nextStatus, nextBlocks = []) => {
      present = true
      status = nextStatus
      blocks = nextBlocks
      publish()
    },
    addChanges: (added) => {
      present = true
      // The latest, at most MAX_CHANGES: awareness goes to every peer on each update
      changes = [...changes, ...added].slice(-MAX_CHANGES)
      publish()
    },
    clearChanges: () => {
      changes = []
      publish()
    },
    clear: () => {
      present = false
      changes = []
      publish()
    }
  }
}

const MAX_CHANGES = 50
