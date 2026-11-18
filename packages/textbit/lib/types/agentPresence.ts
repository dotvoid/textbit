/**
 * How an agent tells the people in a shared document what it is doing: a
 * field of its Y.js awareness state. Editors show it on the blocks it names,
 * read-only ones too. It locks nothing.
 */
export const AGENT_PRESENCE_FIELD = 'textbitAgent'

export type AgentStatus = 'thinking' | 'reading' | 'writing' | 'idle'

export interface AgentPresenceState {
  /** Shown to people, e.g. "Writing assistant" */
  name: string
  /** A CSS colour for its markers */
  color?: string
  status: AgentStatus
  /** Ids of the top-level elements it is working on */
  blocks: string[]
}
