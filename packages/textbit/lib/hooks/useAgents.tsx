import { useContext } from 'react'
import { AgentPresenceContext, type PresentAgent } from '../contexts/AgentPresenceContext'

/**
 * The agents in the shared document and what they are doing, e.g. to show
 * "Writing assistant is thinking" beside the editor or announce it. Empty
 * without collaboration.
 */
export const useAgents = (): PresentAgent[] => useContext(AgentPresenceContext)
