import { createContext } from 'react'
import type { AgentPresenceState } from '../types/agentPresence'

/** An agent present in the shared document, by its Y.js client id */
export type PresentAgent = AgentPresenceState & { clientId: number }

export const AgentPresenceContext = createContext<PresentAgent[]>([])
