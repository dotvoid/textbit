import type { Element } from 'slate'

/**
 * A change proposed for a person to accept or reject, block by block. It is
 * kept beside the document, not in it: in a shared document in a map of the
 * same Y.Doc, so everyone sees it, and it outlives the agent's connection.
 * Plain data, so it can be stored as it is.
 */
export interface Suggestion {
  /** Tells suggestions apart */
  id: string
  /** Who suggests it */
  author: {
    /** Shown to people, e.g. `Writing assistant` */
    name: string
    /** A CSS colour for its marks */
    color?: string
  }
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
  | {
      /** A block changed */
      kind: 'change'
      /** The block's id */
      id: string
      /** `hashNode` of the block as it was */
      before: string
      /** The block as suggested */
      after: Element
    }
  | {
      /** A block deleted */
      kind: 'delete'
      /** The block's id */
      id: string
      /** `hashNode` of the block as it was */
      before: string
    }
  | {
      /** A new block */
      kind: 'insert'
      /** The new block's id */
      id: string
      /** The id of the block it goes after, or null to go first */
      after: string | null
      /** The new block */
      node: Element
    }
