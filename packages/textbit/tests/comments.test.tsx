import { describe, expect, test, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import * as Y from '@y/y'
import { Editor, Transforms, type Descendant } from 'slate'
import { useSlateStatic } from 'slate-react'
import { createTextbitEditor } from '../lib/editor/createTextbitEditor'
import { seedField } from '../lib/yjs/model'
import { commentAnchor, resolveAnchor } from '../lib/comments/anchor'
import { createCommentStore } from '../lib/comments/store'
import type { CommentAuthor, CommentThread } from '../lib/comments/types'
import { TextbitRoot } from '../lib/components/TextbitRoot'
import { TextbitEditable } from '../lib/components/TextbitEditable/TextbitEditable'
import { useComments } from '../lib/hooks/useComments'
import type { CommentsValue } from '../lib/contexts/CommentsContext'

const alice: CommentAuthor = { kind: 'person', id: 'alice', name: 'Alice' }
const bob: CommentAuthor = { kind: 'person', id: 'bob', name: 'Bob' }

const text = 'The harbour in winter, and the harbour asleep.'
const doc = (): Descendant[] => [
  { id: 'p1', type: 'base/text', class: 'text', properties: {}, children: [{ text }] },
  { id: 'p2', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'Boats.' }] }
]
// Slate tells React about a change in a microtask
const settle = () => act(async () => {})

const second = { anchor: { path: [0, 0], offset: 31 }, focus: { path: [0, 0], offset: 38 } }

describe('anchors', () => {
  test('find their text by the quote and what is around it, after edits before it', () => {
    const editor = createTextbitEditor({ value: doc() })
    const anchor = commentAnchor(editor, second)!
    expect(anchor).toMatchObject({ quote: 'harbour', block: 'p1', offset: 31 })
    expect(anchor.start).toBeUndefined()

    Transforms.insertText(editor, 'Cold. ', { at: { path: [0, 0], offset: 0 } })

    // The second "harbour", not the first, though the first is nearer where it was
    expect(resolveAnchor(editor, anchor)).toEqual({ anchor: { path: [0, 0], offset: 37 }, focus: { path: [0, 0], offset: 44 } })
  })

  test('across blocks, are found where they were made', () => {
    const editor = createTextbitEditor({ value: doc() })
    const across = { anchor: { path: [0, 0], offset: 39 }, focus: { path: [1, 0], offset: 5 } }
    const anchor = commentAnchor(editor, across)!
    expect(resolveAnchor(editor, anchor)).toEqual(across)
  })

  test('at the edge of their block, do not move to the same words elsewhere in it', () => {
    const editor = createTextbitEditor({
      value: [{ id: 'c', type: 'base/text', class: 'text', properties: {}, children: [{ text: 'cat sat. cat ran' }] }]
    })
    const first = { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 3 } }
    const anchor = commentAnchor(editor, first)!
    Transforms.delete(editor, { at: first })
    expect(resolveAnchor(editor, anchor)).toBeUndefined()
  })

  test('are detached when their text is gone', () => {
    const editor = createTextbitEditor({ value: doc() })
    const anchor = commentAnchor(editor, second)!
    Transforms.delete(editor, { at: second })
    expect(resolveAnchor(editor, anchor)).toBeUndefined()
  })

  test('follow the text by relative positions in a shared editor, and do not grow with typing at the edges', () => {
    const ydoc = new Y.Doc()
    const field = ydoc.get('body')
    seedField(field, doc())
    const editor = createTextbitEditor({ shared: field })
    const anchor = commentAnchor(editor, second)!
    expect(anchor.start).toEqual(expect.any(String))

    Transforms.insertText(editor, 'Cold. ', { at: { path: [0, 0], offset: 0 } })
    Transforms.insertText(editor, '!', { at: { path: [0, 0], offset: 44 } })
    Transforms.insertText(editor, '>', { at: { path: [0, 0], offset: 37 } })

    expect(resolveAnchor(editor, anchor)).toEqual({ anchor: { path: [0, 0], offset: 38 }, focus: { path: [0, 0], offset: 45 } })
    expect(Editor.string(editor, resolveAnchor(editor, anchor)!)).toBe('harbour')
  })

  test('in a shared editor, deleted text is detached even when the quote is found elsewhere', () => {
    const ydoc = new Y.Doc()
    const field = ydoc.get('body')
    seedField(field, doc())
    const editor = createTextbitEditor({ shared: field })
    const anchor = commentAnchor(editor, second)!
    Transforms.delete(editor, { at: second })
    expect(resolveAnchor(editor, anchor)).toBeUndefined()
  })
})

describe('createCommentStore', () => {
  test('writes as its author, tells about changes, and holds people to their rights', () => {
    const onChange = vi.fn()
    const store = createCommentStore({ author: alice, onChange })
    const thread = store.create({ quote: 'harbour' }, 'Which?')
    const reply = store.reply(thread, 'The old one')
    store.edit(thread, reply, 'The old one, north')
    store.resolve(thread)

    expect(store.threads[0]).toMatchObject({
      author: alice,
      resolved: { by: alice },
      comments: [{ body: 'Which?' }, { body: 'The old one, north', edited: expect.any(Number) }]
    })
    expect(onChange).toHaveBeenCalledTimes(4)

    const bobs = createCommentStore({ author: bob, rights: 'own', threads: store.threads })
    expect(() => bobs.edit(thread, reply, 'Mine now')).toThrow()
    expect(() => bobs.resolve(thread, false)).toThrow()
    expect(() => bobs.remove(thread, reply)).toThrow()
    expect(() => createCommentStore({ author: bob, rights: 'none' }).create({ quote: 'x' }, 'Hi')).toThrow()
    // Nor their own, without rights to comment
    const own = store.threads[0].comments[1].id
    expect(() => createCommentStore({ author: alice, rights: 'none', threads: store.threads })
      .edit(thread, own, 'Changed')).toThrow()
  })
})

describe('comments in the editor', () => {
  function setup(threads: CommentThread[] = []) {
    const store = createCommentStore({ author: alice, threads })
    let comments: CommentsValue | undefined
    let editor: Editor | undefined
    function Probe() {
      comments = useComments()
      editor = useSlateStatic()
      return null
    }
    const result = render(
      <TextbitRoot value={doc()} onChange={() => {}} comments={store}>
        <TextbitEditable aria-label='Text'>
          <Probe />
        </TextbitEditable>
      </TextbitRoot>
    )
    return { ...result, store, comments: () => comments!, editor: () => editor! }
  }
  const highlighted = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-tb-comment]')].map((leaf) => leaf.textContent)

  test('a comment on the selection highlights its text and becomes the one looked at', async () => {
    const { container, comments, editor } = setup()
    act(() => Transforms.select(editor(), second))

    let id: string | undefined
    act(() => {
      id = comments().create('Which harbour?')
    })

    expect(comments().threads).toHaveLength(1)
    expect(comments().active).toBe(id)
    expect(highlighted(container)).toEqual(['harbour'])
    expect(container.querySelector('.tb-comment-active')?.getAttribute('data-tb-comment')).toBe(id)
  })

  test('the caret going into a thread’s text makes it the one looked at', async () => {
    const store = createCommentStore({ author: alice })
    const editor = createTextbitEditor({ value: doc() })
    const first = store.create(commentAnchor(editor, { anchor: { path: [0, 0], offset: 4 }, focus: { path: [0, 0], offset: 11 } })!, 'One')
    const later = store.create(commentAnchor(editor, second)!, 'Two')
    const { comments, editor: live } = setup(store.threads)
    expect(comments().active).toBeUndefined()

    act(() => Transforms.select(live(), { path: [0, 0], offset: 33 }))
    await settle()
    expect(comments().atSelection).toEqual([later])
    expect(comments().active).toBe(later)

    act(() => Transforms.select(live(), { path: [0, 0], offset: 6 }))
    await settle()
    expect(comments().active).toBe(first)
  })

  test('threads come in the order of the text, detached last; resolved ones are not highlighted', () => {
    const store = createCommentStore({ author: alice })
    const editor = createTextbitEditor({ value: doc() })
    const gone = store.create({ block: 'p1', quote: 'lighthouse' }, 'Gone')
    const late = store.create(commentAnchor(editor, second)!, 'Late')
    const early = store.create(commentAnchor(editor, { anchor: { path: [1, 0], offset: 0 }, focus: { path: [1, 0], offset: 5 } })!, 'Boats')
    const resolved = store.create(commentAnchor(editor, { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 3 } })!, 'The')
    store.resolve(resolved)
    const { container, comments } = setup(store.threads)

    expect(comments().threads.map(({ thread, range }) => [thread.id, !!range])).toEqual([
      [resolved, true], [late, true], [early, true], [gone, false]
    ])
    expect(highlighted(container)).toEqual(['harbour', 'Boats'])
  })

  test('without a store there are no comments to make', () => {
    let comments: CommentsValue | undefined
    function Probe() {
      comments = useComments()
      return null
    }
    render(
      <TextbitRoot value={doc()} onChange={() => {}}>
        <TextbitEditable aria-label='Text'><Probe /></TextbitEditable>
      </TextbitRoot>
    )
    expect(comments!.enabled).toBe(false)
    expect(comments!.create('Hi', second)).toBeUndefined()
  })
})
