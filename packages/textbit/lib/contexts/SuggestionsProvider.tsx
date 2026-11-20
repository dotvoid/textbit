import { useCallback, useMemo, type ReactNode } from 'react'
import { useSlateSelector, useSlateStatic } from 'slate-react'
import { SuggestionsContext } from './SuggestionsContext'
import { acceptChange, diffRendererOf, rejectChange, suggestedChanges, type SuggestedChange } from '../suggestions/changes'

/**
 * The suggested changes of an editor showing a fork through Y.js 14's diff
 * renderer: again whenever the text, or what is suggested, changes
 */
export function SuggestionsProvider({ children }: { children: ReactNode }) {
  const editor = useSlateStatic()
  const document = useSlateSelector((e) => e.children)
  const changes = useMemo(
    () => suggestedChanges(editor),
    // The text is a dependency: the changes are read off its marks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, document]
  )

  const accept = useCallback((change: SuggestedChange) => acceptChange(editor, change), [editor])
  const reject = useCallback((change: SuggestedChange) => rejectChange(editor, change), [editor])
  const acceptAll = useCallback(() => diffRendererOf(editor)?.acceptAllChanges(), [editor])
  const rejectAll = useCallback(() => diffRendererOf(editor)?.rejectAllChanges(), [editor])

  const value = useMemo(() => ({
    enabled: !!diffRendererOf(editor),
    changes, accept, reject, acceptAll, rejectAll
  }), [editor, changes, accept, reject, acceptAll, rejectAll])
  return <SuggestionsContext.Provider value={value}>{children}</SuggestionsContext.Provider>
}
