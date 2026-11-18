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
  /**
   * What it changed in its current or last run, for editors to show in the
   * text. Stays after the run, until the next one starts or it is undone.
   */
  changes?: AgentChange[]
}

/**
 * One change to text: new text, removed text, or both where text was replaced.
 * Its place is a range of Y.js relative positions, so it follows the text as
 * people keep typing around it.
 */
export interface AgentChange {
  id: string
  /** The top-level element it is in */
  block: string
  /** Start and end of the new text, as `Y.encodeRelativePosition` bytes; the same for a removal */
  from: number[]
  to: number[]
  /** The text it added, if any */
  added?: string
  /** The text it removed, if any */
  removed?: string
}
