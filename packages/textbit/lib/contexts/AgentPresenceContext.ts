import { createContext } from 'react'
import type { AgentPresenceState } from '../types/agentPresence'

/** An agent present in the shared document, by its Y.js client id */
export type PresentAgent = AgentPresenceState & {
  /** The agent's Y.js client id */
  clientId: number
}

export const AgentPresenceContext = createContext<PresentAgent[]>([])
