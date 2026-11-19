// Comments: threads beside the content, never in it. They live in a root of
// their own, `comments`, in the document's Y.Doc, so the server can tell a
// comment from a change to the content and judge each by its own rules: a
// person who may only comment can, and nobody can write or resolve as someone
// else.
//
// The root holds a node per thread, keyed by the thread's id. A thread's
// attributes say who opened it, where it is anchored and whether it is
// resolved; its children are its comments, the first one opening it. A
// comment's attributes are its author, its text and whether it was edited or
// deleted. A deleted comment stays, emptied, so a thread never loses its shape.
import * as Y from '@y/y'
import type {
  TBComment,
  TBCommentAnchor,
  TBCommentAuthor,
  TBCommentThread
} from '@dotvoid/textbit/headless'

/** The name of the comments root in a document's Y.Doc */
export const COMMENTS = 'comments'

/** Who wrote a comment, as the server knows them */
export type CommentAuthor = TBCommentAuthor

/**
 * Where a thread is: the text field, as a path in the document, and in it as
 * textbit anchors text, by relative positions and by a quote in its block
 */
export interface CommentAnchor extends TBCommentAnchor {
  /** The text field, e.g. `['body']` or `['assignments', '#a1', 'description']` */
  path: string[]
}

export type Comment = TBComment

export interface CommentThread extends Omit<TBCommentThread, 'anchor'> {
  anchor: CommentAnchor
}

/** The attributes a thread node may have */
export const THREAD_KEYS = ['id', 'author', 'onBehalfOf', 'at', 'anchor', 'resolved'] as const
/** The attributes a comment node may have */
export const COMMENT_KEYS = ['id', 'author', 'onBehalfOf', 'at', 'body', 'edited', 'deleted'] as const

/** The threads, oldest first */
export function readThreads(root: Y.Node): CommentThread[] {
  const threads: CommentThread[] = []
  for (const [, value] of root.attrEntries()) {
    const thread = value instanceof Y.Node ? readThread(value) : undefined
    if (thread) {
      threads.push(thread)
    }
  }
  return threads.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
}

/** A thread node as a thread; nothing when it is not one */
export function readThread(node: Y.Node): CommentThread | undefined {
  const id = node.getAttr('id')
  const author = asAuthor(node.getAttr('author'))
  const anchor = node.getAttr('anchor') as CommentAnchor | undefined
  const at = node.getAttr('at')
  if (typeof id !== 'string' || !author || !isAnchor(anchor) || typeof at !== 'number') {
    return undefined
  }
  const comments: Comment[] = []
  for (let i = 0; i < node.length; i++) {
    const child = node.get(i)
    const comment = child instanceof Y.Node ? readComment(child) : undefined
    if (comment) {
      comments.push(comment)
    }
  }
  const onBehalfOf = asAuthor(node.getAttr('onBehalfOf'))
  const resolved = node.getAttr('resolved') as { by?: unknown, at?: unknown } | undefined
  const by = asAuthor(resolved?.by)
  return {
    id,
    author,
    ...(onBehalfOf ? { onBehalfOf } : {}),
    at,
    anchor,
    ...(by && typeof resolved?.at === 'number' ? { resolved: { by, at: resolved.at } } : {}),
    comments
  }
}

function readComment(node: Y.Node): Comment | undefined {
  const id = node.getAttr('id')
  const author = asAuthor(node.getAttr('author'))
  const at = node.getAttr('at')
  const body = node.getAttr('body')
  if (typeof id !== 'string' || !author || typeof at !== 'number' || typeof body !== 'string') {
    return undefined
  }
  const onBehalfOf = asAuthor(node.getAttr('onBehalfOf'))
  const edited = node.getAttr('edited')
  const deleted = node.getAttr('deleted')
  return {
    id,
    author,
    ...(onBehalfOf ? { onBehalfOf } : {}),
    at,
    body,
    ...(typeof edited === 'number' ? { edited } : {}),
    ...(typeof deleted === 'number' ? { deleted } : {})
  }
}

/** What opening a thread takes */
export interface NewThread {
  id: string
  author: CommentAuthor
  onBehalfOf?: CommentAuthor
  at: number
  anchor: CommentAnchor
  /** The first comment */
  comment: { id: string, body: string }
}

/** Opens a thread, with its first comment, in one change */
export function addThread(root: Y.Node, thread: NewThread): void {
  transact(root, () => {
    const node = placeThread(root, thread.id)
    setAttrs(node, {
      id: thread.id,
      author: thread.author,
      onBehalfOf: thread.onBehalfOf,
      at: thread.at,
      anchor: thread.anchor
    })
    appendComment(node, { ...thread.comment, author: thread.author, onBehalfOf: thread.onBehalfOf, at: thread.at })
  })
}

/** Adds a comment to a thread */
export function addReply(
  root: Y.Node,
  threadId: string,
  reply: { id: string, author: CommentAuthor, onBehalfOf?: CommentAuthor, at: number, body: string }
): void {
  const thread = threadNode(root, threadId)
  transact(root, () => appendComment(thread, reply))
}

/** Changes a comment's text */
export function editComment(root: Y.Node, threadId: string, commentId: string, body: string, at: number): void {
  const node = commentNodeOf(root, threadId, commentId)
  transact(root, () => {
    node.setAttr('body', body)
    node.setAttr('edited', at)
  })
}

/** Deletes a comment: it stays, emptied, so the thread keeps its shape */
export function deleteComment(root: Y.Node, threadId: string, commentId: string, at: number): void {
  const node = commentNodeOf(root, threadId, commentId)
  transact(root, () => {
    node.setAttr('body', '')
    node.setAttr('deleted', at)
  })
}

/** Resolves a thread, or opens it again with `null` */
export function setResolved(root: Y.Node, threadId: string, resolved: { by: CommentAuthor, at: number } | null): void {
  const node = threadNode(root, threadId)
  transact(root, () => {
    if (resolved) {
      node.setAttr('resolved', { by: { ...resolved.by }, at: resolved.at })
    } else {
      node.deleteAttr('resolved')
    }
  })
}

/** Fills an empty comments root from threads kept as JSON */
export function seedComments(root: Y.Node, threads: CommentThread[]): void {
  transact(root, () => {
    for (const thread of threads) {
      const node = placeThread(root, thread.id)
      setAttrs(node, Object.fromEntries(THREAD_KEYS.map((key) => [key, thread[key]])))
      for (const comment of thread.comments) {
        appendComment(node, comment)
      }
    }
  })
}

// A node is filled once it is part of the document: what Y.js integrates is
// read back, not the node handed to it
function placeThread(root: Y.Node, id: string): Y.Node {
  root.setAttr(id, new Y.Node('thread'))
  return threadNode(root, id)
}

function appendComment(
  thread: Y.Node,
  comment: Omit<Comment, 'onBehalfOf'> & { onBehalfOf?: CommentAuthor | undefined }
): void {
  thread.push([new Y.Node('comment')])
  const node = thread.get(thread.length - 1)
  if (!(node instanceof Y.Node)) {
    throw new Error('y-quorum: the comment was not created')
  }
  setAttrs(node, Object.fromEntries(COMMENT_KEYS.map((key) => [key, comment[key]])))
}

function setAttrs(node: Y.Node, attrs: Record<string, unknown>) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      node.setAttr(key, typeof value === 'object' && value !== null ? structuredClone(value) : value)
    }
  }
}

function threadNode(root: Y.Node, threadId: string): Y.Node {
  const node = root.getAttr(threadId)
  if (!(node instanceof Y.Node)) {
    throw new Error(`y-quorum: no comment thread ${threadId}`)
  }
  return node
}

function commentNodeOf(root: Y.Node, threadId: string, commentId: string): Y.Node {
  const thread = threadNode(root, threadId)
  for (let i = 0; i < thread.length; i++) {
    const child = thread.get(i)
    if (child instanceof Y.Node && child.getAttr('id') === commentId) {
      return child
    }
  }
  throw new Error(`y-quorum: no comment ${commentId} in thread ${threadId}`)
}

function transact(root: Y.Node, change: () => void) {
  if (root.doc) {
    root.doc.transact(change)
  } else {
    change()
  }
}

/** An author, from what is stored; nothing when it is not one */
export function asAuthor(value: unknown): CommentAuthor | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const { kind, id, name } = value as Record<string, unknown>
  if ((kind === 'person' || kind === 'agent' || kind === 'service') && typeof id === 'string' && typeof name === 'string') {
    return { kind, id, name }
  }
  return undefined
}

function isAnchor(value: unknown): value is CommentAnchor {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const { path, quote } = value as Record<string, unknown>
  return Array.isArray(path) && path.every((segment) => typeof segment === 'string') && typeof quote === 'string'
}
