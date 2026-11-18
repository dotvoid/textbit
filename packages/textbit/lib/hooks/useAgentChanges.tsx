import { useContext } from 'react'
import { AgentChangesContext, type AgentChangesValue } from '../contexts/AgentChangesContext'

/**
 * What agents changed in the text and still stands, with where it is now, and
 * a way to stop showing it, e.g. for a "Mark as seen" button
 */
export const useAgentChanges = (): AgentChangesValue => useContext(AgentChangesContext)
