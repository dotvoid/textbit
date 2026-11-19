import { createContext } from 'react'
import type { Range } from 'slate'
import type { CommentRights, CommentThread } from '../comments/types'

/** A thread as this editor shows it */
export interface ShownThread {
  thread: CommentThread
  /** Where its text is now; absent when that text is gone and the thread is detached */
  range?: Range
}

/** What `useComments` gives */
export interface CommentsValue {
  /** Whether the editor has a comment store at all */
  enabled: boolean
  /** What the person may do with comments */
  rights: CommentRights
  /** Every thread, open and resolved, in the order of the text; detached ones last */
  threads: ShownThread[]
  /** The thread the person is looking at: the one the caret went into, or the one set */
  active?: string
  /** Makes a thread the one looked at, or none */
  setActive: (threadId: string | undefined) => void
  /** The open threads whose text holds the caret */
  atSelection: string[]
  /**
   * Opens a thread on the selected text, or on a range; returns its id, or
   * nothing when there is no text to comment on or no store
   */
  create: (body: string, range?: Range) => string | undefined
  /** Adds a comment to a thread; returns its id */
  reply: (threadId: string, body: string) => string | undefined
  /** Changes the text of a comment */
  edit: (threadId: string, commentId: string, body: string) => void
  /** Deletes a comment, leaving it emptied in the thread */
  remove: (threadId: string, commentId: string) => void
  /** Resolves a thread, or opens it again */
  resolve: (threadId: string, resolved?: boolean) => void
}

export const CommentsContext = createContext<CommentsValue>({
  enabled: false,
  rights: 'none',
  threads: [],
  setActive: () => {},
  atSelection: [],
  create: () => undefined,
  reply: () => undefined,
  edit: () => {},
  remove: () => {},
  resolve: () => {}
})
