import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Point, Range, type Editor } from 'slate'
import { useSlateSelection, useSlateSelector, useSlateStatic } from 'slate-react'
import { CommentsContext, type ShownThread } from './CommentsContext'
import { commentAnchor, resolveAnchor } from '../comments/anchor'
import type { CommentThread, Comments } from '../comments/types'

/**
 * The comments of the editor's text, from the store the host gave, and where
 * each thread is in the text: again whenever they or the text change
 */
export function CommentsProvider({ store, children }: { store?: Comments, children: ReactNode }) {
  const editor = useSlateStatic()
  const document = useSlateSelector((e) => e.children)
  const selection = useSlateSelection()
  const [threads, setThreads] = useState<CommentThread[]>(() => store?.threads ?? [])
  const [active, setActive] = useState<string | undefined>()

  useEffect(() => {
    setThreads(store?.threads ?? [])
    return store?.subscribe(setThreads)
  }, [store])

  const shown = useMemo(
    () => placed(editor, threads),
    // The text is a dependency: where each thread is follows it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, threads, document]
  )

  const atSelection = useMemo(() => {
    if (!selection) {
      return []
    }
    const caret = selection.focus
    return shown
      .filter(({ thread, range }) => !thread.resolved && range && Range.includes(range, caret))
      .map(({ thread }) => thread.id)
  }, [shown, selection])

  // The caret going into a thread's text makes it the one looked at
  const first = atSelection[0]
  useEffect(() => {
    if (first) {
      setActive(first)
    }
  }, [first])

  const create = useCallback((body: string, range?: Range) => {
    const at = range ?? editor.selection
    const anchor = store && at ? commentAnchor(editor, at) : undefined
    if (!store || !anchor) {
      return undefined
    }
    const id = store.create(anchor, body)
    setActive(id)
    return id
  }, [editor, store])

  const value = useMemo(() => ({
    enabled: !!store,
    rights: store?.rights ?? 'none',
    threads: shown,
    active,
    setActive,
    atSelection,
    create,
    reply: (threadId: string, body: string) => store?.reply(threadId, body),
    edit: (threadId: string, commentId: string, body: string) => store?.edit(threadId, commentId, body),
    remove: (threadId: string, commentId: string) => store?.remove(threadId, commentId),
    resolve: (threadId: string, resolved?: boolean) => store?.resolve(threadId, resolved)
  }), [store, shown, active, atSelection, create])

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>
}

// Each thread with where it is now, in the order of the text, detached last
function placed(editor: Editor, threads: CommentThread[]): ShownThread[] {
  const shown = threads.map((thread) => {
    const range = resolveAnchor(editor, thread.anchor)
    return range ? { thread, range } : { thread }
  })
  return shown.sort((a, b) => {
    if (!a.range || !b.range) {
      return a.range ? -1 : b.range ? 1 : 0
    }
    return Point.compare(Range.start(a.range), Range.start(b.range))
  })
}
