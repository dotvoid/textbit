import { useEffect, useState, type ReactNode } from 'react'
import { useSharedAwareness } from './SharedAwarenessContext'
import { AgentPresenceContext, type PresentAgent } from './AgentPresenceContext'
import { AGENT_PRESENCE_FIELD, type AgentPresenceState } from '../types/agentPresence'

/**
 * The agents in the shared document, from the other peers' awareness states.
 * Without collaboration there are none.
 */
export function AgentPresenceProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<PresentAgent[]>([])
  const { awareness } = useSharedAwareness()

  useEffect(() => {
    if (!awareness) {
      setAgents([])
      return
    }

    const update = () => {
      const present: PresentAgent[] = []
      for (const [clientId, state] of awareness.getStates() as Map<number, Record<string, unknown>>) {
        const agent = state?.[AGENT_PRESENCE_FIELD]
        if (clientId !== awareness.clientID && isPresence(agent)) {
          present.push({ ...agent, clientId })
        }
      }
      setAgents((previous) => same(previous, present) ? previous : present)
    }

    update()
    awareness.on('change', update)
    return () => {
      awareness.off('change', update)
    }
  }, [awareness])

  return <AgentPresenceContext.Provider value={agents}>{children}</AgentPresenceContext.Provider>
}

function isPresence(value: unknown): value is AgentPresenceState {
  const state = value as AgentPresenceState | null
  return !!state && typeof state.name === 'string' && typeof state.status === 'string' && Array.isArray(state.blocks)
}

function same(a: PresentAgent[], b: PresentAgent[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
