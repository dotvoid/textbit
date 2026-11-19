// Whether a change to the comments may be stored: the comments as they are,
// the comments as the change would leave them, and who is changing them.
//
// The change is judged by what it does to each thread it touches, read as
// threads before and after, not by its Y.js structure: whatever the bytes,
// what counts is that nobody writes as someone else, edits someone else's
// words, or resolves or deletes what is not theirs unless they may.
import * as Y from '@y/y'
import {
  COMMENT_KEYS,
  THREAD_KEYS,
  readThread,
  type Comment,
  type CommentAuthor,
  type CommentThread
} from '@dotvoid/y-quorum-client/model'
import type { CommentRights } from '@dotvoid/y-quorum-client/protocol'
import type { Actor } from './types'

/**
 * Nothing when the change may be stored, the reason when not.
 *
 * @param before The comments root as it is
 * @param after The comments root with the change applied, in a copy
 * @param changed What the change touched in `after`, as Y.js reports it
 */
export function judgeComments(
  before: Y.Node,
  after: Y.Node,
  changed: Map<Y.Node, Set<string | null>>,
  actor: Actor,
  rights: CommentRights
): string | undefined {
  if (rights === 'none') {
    return 'Not allowed to comment here'
  }

  const touched = new Set<string>()
  for (const [node, keys] of changed) {
    if (node === after) {
      if (keys.has(null)) {
        return 'Comments are threads held by their id, nothing else'
      }
      keys.forEach((key) => touched.add(key!))
      continue
    }
    const thread = threadOf(node, after)
    if (thread === undefined) {
      return 'Comments are threads of comments, nothing deeper'
    }
    touched.add(thread)
  }

  for (const id of touched) {
    const reason = judgeThread(before.getAttr(id), after.getAttr(id), id, actor, rights)
    if (reason) {
      return reason
    }
  }
  return undefined
}

function judgeThread(
  beforeValue: unknown,
  afterValue: unknown,
  id: string,
  actor: Actor,
  rights: CommentRights
): string | undefined {
  const before = beforeValue instanceof Y.Node ? readThread(beforeValue) : undefined
  if (afterValue === undefined) {
    return before && rights !== 'all' ? 'Only an editor may remove a thread' : undefined
  }
  const after = afterValue instanceof Y.Node ? readThread(afterValue) : undefined
  if (!after || after.id !== id) {
    return 'Not a comment thread'
  }
  const shape = shapeOf(afterValue as Y.Node)
  if (shape) {
    return shape
  }

  if (!before) {
    if (!isActor(after.author, after.onBehalfOf, actor)) {
      return 'A thread is opened in your own name'
    }
    if (!after.comments.length || after.resolved) {
      return 'A thread opens with a comment, unresolved'
    }
    return newComments(after.comments, actor)
  }

  if (!same(threadFixed(before), threadFixed(after))) {
    return 'Who opened a thread, when and where, does not change'
  }
  if (!same(before.resolved, after.resolved) && rights !== 'all' && !isActor(before.author, before.onBehalfOf, actor)) {
    return 'Only who opened a thread, or an editor, may resolve it'
  }

  const was = new Map(before.comments.map((comment) => [comment.id, comment]))
  const added: Comment[] = []
  for (const comment of after.comments) {
    const old = was.get(comment.id)
    was.delete(comment.id)
    if (!old) {
      added.push(comment)
      continue
    }
    const reason = judgeComment(old, comment, actor, rights)
    if (reason) {
      return reason
    }
  }
  if (was.size && rights !== 'all') {
    return 'Only an editor may remove a comment'
  }
  return newComments(added, actor)
}

function judgeComment(before: Comment, after: Comment, actor: Actor, rights: CommentRights): string | undefined {
  if (!same(commentFixed(before), commentFixed(after))) {
    return 'Who wrote a comment, and when, does not change'
  }
  const own = isActor(before.author, before.onBehalfOf, actor)
  if (before.deleted !== after.deleted) {
    return own || rights === 'all' ? undefined : 'Only its author, or an editor, may delete a comment'
  }
  if (before.body !== after.body || before.edited !== after.edited) {
    return own ? undefined : 'Only its author may edit a comment'
  }
  return undefined
}

function newComments(comments: Comment[], actor: Actor): string | undefined {
  const ids = new Set<string>()
  for (const comment of comments) {
    if (!isActor(comment.author, comment.onBehalfOf, actor)) {
      return 'A comment is written in your own name'
    }
    if (comment.deleted !== undefined || comment.edited !== undefined) {
      return 'A new comment is neither edited nor deleted'
    }
    if (ids.has(comment.id)) {
      return 'Two comments with one id'
    }
    ids.add(comment.id)
  }
  return undefined
}

// Only the attributes threads and comments have, and no comments in comments
function shapeOf(thread: Y.Node): string | undefined {
  const ids = new Set<string>()
  if (!keysWithin(thread, THREAD_KEYS)) {
    return 'A thread has only its own attributes'
  }
  for (let i = 0; i < thread.length; i++) {
    const comment = thread.get(i)
    if (!(comment instanceof Y.Node) || comment.length || !keysWithin(comment, COMMENT_KEYS)) {
      return 'A thread holds comments and nothing else'
    }
    const id = comment.getAttr('id')
    if (typeof id !== 'string' || ids.has(id)) {
      return 'Every comment has an id of its own'
    }
    ids.add(id)
  }
  return undefined
}

function keysWithin(node: Y.Node, allowed: readonly string[]): boolean {
  for (const key of node.attrKeys()) {
    if (!allowed.includes(String(key))) {
      return false
    }
  }
  return true
}

// The id of the thread a node is part of: the root's attribute holding it
function threadOf(node: Y.Node, root: Y.Node): string | undefined {
  let current: Y.Node | null = node
  let depth = 0
  while (current && current.parent !== root) {
    current = current.parent
    if (++depth > 1) {
      return undefined
    }
  }
  const id = current?.getAttr('id')
  return current && typeof id === 'string' && root.getAttr(id) === current ? id : undefined
}

/** Whether an author is the one acting: the principal, for whom it acts */
function isActor(author: CommentAuthor, onBehalfOf: CommentAuthor | undefined, actor: Actor): boolean {
  const as = (who: CommentAuthor, principal: Actor['principal']) =>
    who.kind === principal.kind && who.id === principal.id && who.name === principal.name
  if (!as(author, actor.principal)) {
    return false
  }
  if (actor.onBehalfOf) {
    return onBehalfOf !== undefined && as(onBehalfOf, actor.onBehalfOf)
  }
  return onBehalfOf === undefined
}

function threadFixed(thread: CommentThread) {
  return [thread.author, thread.onBehalfOf, thread.at, thread.anchor]
}

function commentFixed(comment: Comment) {
  return [comment.author, comment.onBehalfOf, comment.at]
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
