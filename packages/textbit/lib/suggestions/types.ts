import type { Element } from 'slate'

/**
 * A change proposed for a person to accept or reject, block by block. It is
 * kept beside the document, not in it: in a shared document in a map of the
 * same Y.Doc, so everyone sees it, and it outlives the agent's connection.
 * Plain data, so it can be stored as it is.
 */
export interface Suggestion {
  id: string
  /** Who suggests it */
  author: { name: string, color?: string }
  /** Milliseconds since 1970 */
  createdAt: number
  /** The suggestion block by block, in document order */
  blocks: SuggestedBlock[]
}

/**
 * One top-level block of a suggestion. `before` is a hash of the block as it
 * was when suggested: if the block changed since, the suggestion is out of
 * date and can only be rejected.
 */
export type SuggestedBlock =
  | { kind: 'change', id: string, before: string, after: Element }
  | { kind: 'delete', id: string, before: string }
  /** A new block, after the block `after` names, or first when it is null */
  | { kind: 'insert', id: string, after: string | null, node: Element }
