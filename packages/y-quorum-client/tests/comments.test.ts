import { describe, expect, it } from 'vitest'
import * as Y from '@y/y'
import {
  COMMENTS,
  addReply,
  addThread,
  deleteComment,
  editComment,
  readThreads,
  seedComments,
  setResolved,
  type CommentAuthor
} from '../lib/model'

const alice: CommentAuthor = { kind: 'person', id: 'alice', name: 'Alice' }
const bob: CommentAuthor = { kind: 'person', id: 'bob', name: 'Bob' }
const anchor = { path: ['body'], quote: 'harbour', block: 'b1', offset: 4 }

describe('comments', () => {
  it('opens a thread, replies, edits, deletes and resolves', () => {
    const doc = new Y.Doc()
    const root = doc.get(COMMENTS)

    addThread(root, { id: 't1', author: alice, at: 1, anchor, comment: { id: 'c1', body: 'Which one?' } })
    addReply(root, 't1', { id: 'c2', author: bob, at: 2, body: 'The old one' })
    editComment(root, 't1', 'c2', 'The old one, north', 3)
    deleteComment(root, 't1', 'c1', 4)
    setResolved(root, 't1', { by: bob, at: 5 })

    expect(readThreads(root)).toEqual([{
      id: 't1',
      author: alice,
      at: 1,
      anchor,
      resolved: { by: bob, at: 5 },
      comments: [
        { id: 'c1', author: alice, at: 1, body: '', deleted: 4 },
        { id: 'c2', author: bob, at: 2, body: 'The old one, north', edited: 3 }
      ]
    }])

    setResolved(root, 't1', null)
    expect(readThreads(root)[0].resolved).toBeUndefined()
  })

  it('travels to another copy, and back from JSON', () => {
    const doc = new Y.Doc()
    addThread(doc.get(COMMENTS), { id: 't1', author: alice, at: 1, anchor, comment: { id: 'c1', body: 'Hm' } })
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc))
    expect(readThreads(copy.get(COMMENTS))).toEqual(readThreads(doc.get(COMMENTS)))

    const fromJSON = new Y.Doc()
    seedComments(fromJSON.get(COMMENTS), readThreads(doc.get(COMMENTS)))
    expect(readThreads(fromJSON.get(COMMENTS))).toEqual(readThreads(doc.get(COMMENTS)))
  })
})
