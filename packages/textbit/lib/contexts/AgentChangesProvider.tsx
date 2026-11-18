import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useSlateSelector, useSlateStatic } from 'slate-react'
import { AgentPresenceContext } from './AgentPresenceContext'
import { AgentChangesContext } from './AgentChangesContext'
import { resolveAgentChanges } from '../utils/agentChanges'

/**
 * The agents' changes, resolved against the document as it is now: again
 * whenever it or the agents' presence changes
 */
export function AgentChangesProvider({ children }: { children: ReactNode }) {
  const agents = useContext(AgentPresenceContext)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const document = useSlateSelector((editor) => editor.children)
  const editor = useSlateStatic()

  const changes = useMemo(
    () => agents.length ? resolveAgentChanges(editor, agents, dismissed) : [],
    // The document is a dependency: positions resolve against its content
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, agents, dismissed, document]
  )

  const dismiss = useCallback((ids?: string[]) => {
    setDismissed((previous) => new Set([...previous, ...ids ?? changes.map((change) => change.id)]))
  }, [changes])

  const value = useMemo(() => ({ changes, dismiss }), [changes, dismiss])
  return <AgentChangesContext.Provider value={value}>{children}</AgentChangesContext.Provider>
}
