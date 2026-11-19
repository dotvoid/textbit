// A document's comments, for one handle: read them, follow them, and write
// them in the name of whoever is logged in, or of an agent working for them.
// The server checks every write; this only makes the right ones easy.
import * as Y from '@y/y'
import {
  COMMENTS,
  addReply,
  addThread,
  deleteComment,
  editComment,
  readThreads,
  setResolved,
  type CommentAnchor,
  type CommentAuthor,
  type CommentThread
} from './comments'
import type { ActorClaim, CommentRights, Principal } from './protocol'

/** What a handle needs to give for its comments */
export interface CommentsHost {
  readonly doc: Y.Doc
  readonly capabilities: { comments?: CommentRights }
  claimOrigin(claim: ActorClaim): object
  on(event: 'rebuilt', fn: (arg: { doc: Y.Doc }) => void): void
  off(event: 'rebuilt', fn: (arg: { doc: Y.Doc }) => void): void
}

/** A document's comments, as one handle sees them */
export interface Comments {
  /** The threads, oldest first */
  readonly threads: CommentThread[]
  /** What this connection may do with them */
  readonly rights: CommentRights
  /** Called with the threads whenever they change, here or elsewhere */
  subscribe(listener: (threads: CommentThread[]) => void): () => void
  /** Opens a thread on some text; returns its id */
  create(anchor: CommentAnchor, body: string, claim?: ActorClaim): string
  /** Adds a comment to a thread; returns its id */
  reply(threadId: string, body: string, claim?: ActorClaim): string
  /** Changes the text of one of your comments */
  edit(threadId: string, commentId: string, body: string, claim?: ActorClaim): void
  /** Deletes a comment: it stays in the thread, emptied */
  remove(threadId: string, commentId: string, claim?: ActorClaim): void
  /** Resolves a thread, or opens it again */
  resolve(threadId: string, resolved?: boolean, claim?: ActorClaim): void
}

export class CommentsOfHandle implements Comments {
  private listeners = new Set<(threads: CommentThread[]) => void>()
  private cached: CommentThread[] | undefined
  private stop: () => void = () => undefined

  constructor(private readonly host: CommentsHost, private readonly principal: () => Principal | undefined) {
    host.on('rebuilt', this.rebuilt)
  }

  // Always the handle's current document: after a refusal it is replaced at once
  private get root(): Y.Node {
    return this.host.doc.get(COMMENTS)
  }

  get threads(): CommentThread[] {
    // Kept only while followed: nothing else says when it is out of date
    if (!this.listeners.size) {
      return readThreads(this.root)
    }
    this.cached ??= readThreads(this.root)
    return this.cached
  }

  get rights(): CommentRights {
    return this.host.capabilities.comments ?? 'none'
  }

  subscribe(listener: (threads: CommentThread[]) => void): () => void {
    if (!this.listeners.size) {
      this.observe()
    }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        this.stop()
      }
    }
  }

  create(anchor: CommentAnchor, body: string, claim?: ActorClaim): string {
    const id = crypto.randomUUID()
    this.write(claim, (who) => addThread(this.root, {
      id, ...who, at: Date.now(), anchor, comment: { id: crypto.randomUUID(), body }
    }))
    return id
  }

  reply(threadId: string, body: string, claim?: ActorClaim): string {
    const id = crypto.randomUUID()
    this.write(claim, (who) => addReply(this.root, threadId, { id, ...who, at: Date.now(), body }))
    return id
  }

  edit(threadId: string, commentId: string, body: string, claim?: ActorClaim): void {
    this.write(claim, () => editComment(this.root, threadId, commentId, body, Date.now()))
  }

  remove(threadId: string, commentId: string, claim?: ActorClaim): void {
    this.write(claim, () => deleteComment(this.root, threadId, commentId, Date.now()))
  }

  resolve(threadId: string, resolved = true, claim?: ActorClaim): void {
    this.write(claim, (who) => setResolved(this.root, threadId, resolved ? { by: who.author, at: Date.now() } : null))
  }

  /** Stops following the document, for a released handle */
  destroy(): void {
    this.stop()
    this.listeners.clear()
    this.host.off('rebuilt', this.rebuilt)
  }

  // A write in the name of who is logged in, or of an agent working for them
  private write(claim: ActorClaim | undefined, change: (who: { author: CommentAuthor, onBehalfOf?: CommentAuthor }) => void) {
    const principal = this.principal()
    if (!principal) {
      throw new Error('y-quorum: comments are written once the client is connected')
    }
    const person = authorOf(principal)
    const who = claim
      ? { author: { kind: 'agent' as const, id: claim.agent, name: claim.name ?? claim.agent }, onBehalfOf: person }
      : { author: person }
    this.root.doc!.transact(() => change(who), claim ? this.host.claimOrigin(claim) : undefined)
  }

  private observe() {
    const root = this.root
    const changed = () => {
      this.cached = undefined
      const threads = this.threads
      for (const listener of [...this.listeners]) {
        listener(threads)
      }
    }
    root.observeDeep(changed)
    this.stop = () => root.unobserveDeep(changed)
  }

  // The handle's document was replaced: follow the new one
  private rebuilt = () => {
    const following = this.listeners.size > 0
    this.stop()
    this.cached = undefined
    if (following) {
      this.observe()
      const threads = this.threads
      for (const listener of [...this.listeners]) {
        listener(threads)
      }
    }
  }
}

function authorOf(principal: Principal): CommentAuthor {
  return { kind: principal.kind, id: principal.id, name: principal.name }
}
