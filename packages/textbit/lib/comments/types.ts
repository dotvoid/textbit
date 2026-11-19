// Comments beside the text: threads anchored to a range, kept by a store the
// host gives, such as a collaboration server's or one of its own. The editor
// finds each anchor in the text, highlights it, and helps write comments; who
// may do what is the store's to decide.

/** Who wrote a comment */
export interface CommentAuthor {
  kind: 'person' | 'agent' | 'service'
  id: string
  name: string
}

/**
 * Where a thread is in the text, stored two ways. `start` and `end` are Y.js
 * relative positions, base64: precise, and they follow the text as it is
 * edited, in a shared editor. The rest is a text selector for any editor: the
 * quoted text within the block that held it, at about the offset it had.
 */
export interface CommentAnchor {
  /** The relative position of the start, base64 */
  start?: string
  /** The relative position of the end, base64 */
  end?: string
  /** The id of the element the quote is in */
  block?: string
  /** The quote's offset in the element's text */
  offset?: number
  /** The text commented on */
  quote: string
  /** A little text before the quote, to tell one occurrence from another */
  prefix?: string
  /** A little text after it */
  suffix?: string
}

/** One comment of a thread */
export interface Comment {
  id: string
  author: CommentAuthor
  /** The person an agent wrote it for */
  onBehalfOf?: CommentAuthor
  /** When it was written, in milliseconds */
  at: number
  /** Its text; empty when deleted */
  body: string
  /** When it was last edited */
  edited?: number
  /** When it was deleted */
  deleted?: number
}

/** A thread: comments on one range of text, the first one opening it */
export interface CommentThread {
  id: string
  author: CommentAuthor
  onBehalfOf?: CommentAuthor
  at: number
  anchor: CommentAnchor
  /** Who resolved it, and when; absent while open */
  resolved?: { by: CommentAuthor, at: number }
  comments: Comment[]
}

/**
 * What someone may do with comments: nothing; open threads, reply, and edit,
 * delete and resolve their own; or also resolve and delete anyone's
 */
export type CommentRights = 'none' | 'own' | 'all'

/**
 * Where an editor's comments are kept: give one to `Textbit.Root` as
 * `comments`. `createCommentStore` keeps them in memory, for a host that saves
 * them itself; a collaboration server's client gives one per text field.
 */
export interface Comments {
  /** The threads, oldest first */
  readonly threads: CommentThread[]
  /** What the person may do with them */
  readonly rights: CommentRights
  /** Called with the threads whenever they change; returns the unsubscribe */
  subscribe(listener: (threads: CommentThread[]) => void): () => void
  /** Opens a thread on some text; returns its id */
  create(anchor: CommentAnchor, body: string): string
  /** Adds a comment to a thread; returns its id */
  reply(threadId: string, body: string): string
  /** Changes the text of a comment */
  edit(threadId: string, commentId: string, body: string): void
  /** Deletes a comment: it stays in the thread, emptied */
  remove(threadId: string, commentId: string): void
  /** Resolves a thread, or opens it again */
  resolve(threadId: string, resolved?: boolean): void
}
