import { useEffect, useRef, useState } from 'react'
import { Range, Transforms } from 'slate'
import { ReactEditor, useSlateSelection, useSlateStatic } from 'slate-react'
import { useComments, type TBShownThread } from '@dotvoid/textbit'

/**
 * The threads beside the text, built on `useComments`: comment on the
 * selection, reply, resolve, and go to a thread's text. `composing` opens the
 * new comment box, e.g. from the context menu.
 */
export const CommentsPanel = ({ composing, onComposed, me }: {
  composing: boolean
  onComposed: () => void
  /** Who is writing, to know which comments are theirs */
  me: string
}) => {
  const comments = useComments()
  const selection = useSlateSelection()
  const [showResolved, setShowResolved] = useState(false)
  const canComment = comments.rights !== 'none' && !!selection && Range.isExpanded(selection)

  if (!comments.enabled) {
    return null
  }

  const shown = comments.threads.filter(({ thread }) => showResolved || !thread.resolved)

  return (
    <aside className='demo-comments' aria-label='Comments'>
      <header>
        <h2>Comments</h2>
        <label>
          <input type='checkbox' checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Resolved
        </label>
      </header>
      {composing && canComment
        ? <NewComment onDone={onComposed} />
        : comments.rights !== 'none' && (
          <p className='demo-comments-hint'>
            {canComment ? 'Right-click the selection and choose Comment.' : 'Select text to comment on it.'}
          </p>
        )}
      {shown.map((shownThread) => (
        <Thread key={shownThread.thread.id} shown={shownThread} me={me} />
      ))}
      {!shown.length && <p className='demo-comments-hint'>No comments yet.</p>}
    </aside>
  )
}

const NewComment = ({ onDone }: { onDone: () => void }) => {
  const { create } = useComments()
  const [body, setBody] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  return (
    <form
      className='demo-comment-form'
      onSubmit={(e) => {
        e.preventDefault()
        if (body.trim()) {
          create(body.trim())
        }
        onDone()
      }}
    >
      <textarea ref={field} aria-label='New comment' value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      <div>
        <button type='submit'>Comment</button>
        <button type='button' onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}

const Thread = ({ shown: { thread, range }, me }: { shown: TBShownThread, me: string }) => {
  const editor = useSlateStatic()
  const { active, setActive, reply, resolve, remove, rights } = useComments()
  const [answer, setAnswer] = useState('')
  const isActive = active === thread.id
  const mayResolve = rights === 'all' || thread.author.id === me

  const goTo = () => {
    setActive(thread.id)
    if (range) {
      Transforms.select(editor, range)
      ReactEditor.focus(editor)
    }
  }

  return (
    <article className='demo-thread' data-active={isActive || undefined} data-resolved={thread.resolved ? '' : undefined}>
      <button type='button' className='demo-thread-quote' onClick={goTo} aria-label={`Go to “${thread.anchor.quote}”`}>
        {range ? `“${thread.anchor.quote}”` : <>“{thread.anchor.quote}”, <em>its text is gone</em></>}
      </button>
      {thread.comments.map((comment) => (
        <div key={comment.id} className='demo-comment'>
          <strong>
            {comment.author.name}
            {comment.onBehalfOf ? `, for ${comment.onBehalfOf.name}` : ''}
          </strong>
          {comment.deleted
            ? <p><em>Deleted</em></p>
            : <p>{comment.body}{comment.edited ? <em> (edited)</em> : null}</p>}
          {!comment.deleted && (comment.author.id === me || rights === 'all') && (
            <button type='button' className='demo-link' onClick={() => remove(thread.id, comment.id)}>Delete</button>
          )}
        </div>
      ))}
      {thread.resolved
        ? <p className='demo-comments-hint'>Resolved by {thread.resolved.by.name}</p>
        : rights !== 'none' && (
          <form
            className='demo-comment-form'
            onSubmit={(e) => {
              e.preventDefault()
              if (answer.trim()) {
                reply(thread.id, answer.trim())
                setAnswer('')
              }
            }}
          >
            <input aria-label='Reply' placeholder='Reply' value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </form>
        )}
      {mayResolve && (
        <button type='button' className='demo-link' onClick={() => resolve(thread.id, !thread.resolved)}>
          {thread.resolved ? 'Reopen' : 'Resolve'}
        </button>
      )}
    </article>
  )
}
