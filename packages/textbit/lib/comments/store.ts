import type { Comment, CommentAnchor, CommentAuthor, CommentRights, CommentThread, Comments } from './types'

/** What `createCommentStore` takes */
export interface CommentStoreOptions {
  /** Who writes: every comment made through the store is theirs */
  author: CommentAuthor
  /** The threads to start with, e.g. as the host saved them */
  threads?: CommentThread[]
  /** What the author may do. Default: `'all'`. */
  rights?: CommentRights
  /** The threads after every change, to save them */
  onChange?: (threads: CommentThread[]) => void
}

/**
 * Comments kept in memory, for a host that saves them itself: give the
 * threads it saved, and save what `onChange` gives. A collaboration server's
 * client gives a store of its own instead.
 */
export function createCommentStore(options: CommentStoreOptions): Comments {
  const { author } = options
  const rights = options.rights ?? 'all'
  let threads: CommentThread[] = structuredClone(options.threads ?? [])
  const listeners = new Set<(threads: CommentThread[]) => void>()

  const change = (next: CommentThread[]) => {
    threads = next
    options.onChange?.(threads)
    for (const listener of [...listeners]) {
      listener(threads)
    }
  }
  const allowed = (owner: CommentAuthor) => {
    if (rights === 'none' || (rights === 'own' && owner.id !== author.id)) {
      throw new Error(`textbit: ${author.name} may not do that with comments`)
    }
  }
  const thread = (id: string) => {
    const found = threads.find((candidate) => candidate.id === id)
    if (!found) {
      throw new Error(`textbit: no comment thread ${id}`)
    }
    return found
  }
  const withComment = (threadId: string, commentId: string, update: (comment: Comment) => Comment) => {
    const found = thread(threadId)
    const comment = found.comments.find((candidate) => candidate.id === commentId)
    if (!comment) {
      throw new Error(`textbit: no comment ${commentId}`)
    }
    return { found, comment, apply: () => change(threads.map((t) => t !== found ? t : {
      ...t, comments: t.comments.map((c) => c === comment ? update(c) : c)
    })) }
  }

  return {
    get threads() {
      return threads
    },
    get rights() {
      return rights
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    create(anchor: CommentAnchor, body: string) {
      allowed(author)
      const at = Date.now()
      const id = crypto.randomUUID()
      change([...threads, { id, author, at, anchor, comments: [{ id: crypto.randomUUID(), author, at, body }] }])
      return id
    },
    reply(threadId, body) {
      allowed(author)
      const found = thread(threadId)
      const id = crypto.randomUUID()
      change(threads.map((t) => t !== found ? t : { ...t, comments: [...t.comments, { id, author, at: Date.now(), body }] }))
      return id
    },
    edit(threadId, commentId, body) {
      const { comment, apply } = withComment(threadId, commentId, (c) => ({ ...c, body, edited: Date.now() }))
      if (comment.author.id !== author.id) {
        throw new Error('textbit: only its author edits a comment')
      }
      apply()
    },
    remove(threadId, commentId) {
      const { comment, apply } = withComment(threadId, commentId, (c) => ({ ...c, body: '', deleted: Date.now() }))
      allowed(comment.author)
      apply()
    },
    resolve(threadId, resolved = true) {
      const found = thread(threadId)
      allowed(found.author)
      change(threads.map((t) => {
        if (t !== found) {
          return t
        }
        const next = { ...t }
        delete next.resolved
        return resolved ? { ...next, resolved: { by: author, at: Date.now() } } : next
      }))
    }
  }
}
