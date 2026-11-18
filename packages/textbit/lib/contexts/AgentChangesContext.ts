import { createContext } from 'react'
import type { ResolvedAgentChange } from '../utils/agentChanges'

export interface AgentChangesValue {
  /** The agents' changes still standing in the document, where they now are */
  changes: ResolvedAgentChange[]
  /** Stop showing changes in this editor: these, or all */
  dismiss: (ids?: string[]) => void
}

export const AgentChangesContext = createContext<AgentChangesValue>({ changes: [], dismiss: () => {} })
