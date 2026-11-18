/**
 * How an agent tells the people in a shared document what it is doing: a
 * field of its Y.js awareness state. Editors show it on the blocks it names,
 * read-only ones too. It locks nothing.
 */
export const AGENT_PRESENCE_FIELD = 'textbitAgent'

/**
 * What an agent does: `thinking` between steps of a task, `reading` the
 * document, `writing` while an edit is in progress, `idle` between tasks
 */
export type AgentStatus = 'thinking' | 'reading' | 'writing' | 'idle'

/**
 * An agent's presence, the value of its awareness field `textbitAgent`:
 *
 * ```ts
 * awareness.setLocalStateField(AGENT_PRESENCE_FIELD, {
 *   name: 'Writing assistant', color: '#7c3aed', status: 'writing', blocks: [blockId]
 * })
 * ```
 */
export interface AgentPresenceState {
  /** Shown to people, e.g. "Writing assistant" */
  name: string
  /** A CSS colour for its markers */
  color?: string
  /** What it does */
  status: AgentStatus
  /** Ids of the top-level elements it is working on: marked while it is `writing` */
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
  /** Tells changes apart */
  id: string
  /** The top-level element it is in */
  block: string
  /** Start and end of the new text, as `Y.encodeRelativePosition` bytes; the same for a removal */
  from: number[]
  /** End of the new text, as `Y.encodeRelativePosition` bytes */
  to: number[]
  /** The text it added, if any */
  added?: string
  /** The text it removed, if any */
  removed?: string
}
