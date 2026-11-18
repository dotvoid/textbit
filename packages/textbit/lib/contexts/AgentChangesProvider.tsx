import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSlateSelector, useSlateStatic } from 'slate-react'
import { AgentPresenceContext } from './AgentPresenceContext'
import { AgentChangesContext } from './AgentChangesContext'
import { resolveAgentChanges } from '../utils/agentChanges'
import { useTextbit } from '../hooks/useTextbit'

/** How long a change takes to fade out once its time is up */
export const AGENT_CHANGE_FADE_MS = 1200

/**
 * The agents' changes, resolved against the document as it is now: again
 * whenever it or the agents' presence changes.
 *
 * A change is marked for a while, `agentChangeDuration`, from when this
 * editor first shows it, counted only while the page is visible: someone who
 * looked away still sees what happened when they come back. Then it fades,
 * and goes.
 */
export function AgentChangesProvider({ children }: { children: ReactNode }) {
  const agents = useContext(AgentPresenceContext)
  const { agentChangeDuration } = useTextbit()
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [fading, setFading] = useState<ReadonlySet<string>>(() => new Set())
  const document = useSlateSelector((editor) => editor.children)
  const editor = useSlateStatic()

  const resolved = useMemo(
    () => agents.length ? resolveAgentChanges(editor, agents, dismissed) : [],
    // The document is a dependency: positions resolve against its content
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, agents, dismissed, document]
  )

  const changes = useMemo(
    () => fading.size ? resolved.map((change) => fading.has(change.id) ? { ...change, fading: true } : change) : resolved,
    [resolved, fading]
  )

  useChangeTimers(resolved, agentChangeDuration, setFading, setDismissed)

  const dismiss = useCallback((ids?: string[]) => {
    setDismissed((previous) => new Set([...previous, ...ids ?? resolved.map((change) => change.id)]))
  }, [resolved])

  const value = useMemo(() => ({ changes, dismiss }), [changes, dismiss])
  return <AgentChangesContext.Provider value={value}>{children}</AgentChangesContext.Provider>
}

type SetIds = (update: (previous: ReadonlySet<string>) => ReadonlySet<string>) => void

/** Fade each change out its duration after it is first shown on a visible page */
function useChangeTimers(
  changes: { id: string }[],
  duration: number,
  setFading: SetIds,
  setDismissed: SetIds
) {
  const shownAt = useRef(new Map<string, number>())
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)

  // Time the page is hidden does not count: the clock of each change is moved
  // on by it when the page shows again
  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    let hiddenSince = document.hidden ? Date.now() : 0
    const update = () => {
      if (document.hidden) {
        hiddenSince = Date.now()
      } else if (hiddenSince) {
        const away = Date.now() - hiddenSince
        hiddenSince = 0
        for (const [id, at] of shownAt.current) {
          shownAt.current.set(id, at + away)
        }
      }
      setVisible(!document.hidden)
    }
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    if (!duration || !visible) {
      return
    }
    const now = Date.now()
    const timers: ReturnType<typeof setTimeout>[] = []

    for (const { id } of changes) {
      if (!shownAt.current.has(id)) {
        shownAt.current.set(id, now)
      }
      const left = shownAt.current.get(id)! + duration - now
      timers.push(setTimeout(() => setFading((previous) => add(previous, id)), Math.max(0, left)))
      timers.push(setTimeout(() => setDismissed((previous) => add(previous, id)), Math.max(0, left) + AGENT_CHANGE_FADE_MS))
    }
    return () => timers.forEach(clearTimeout)
  }, [changes, duration, visible, setFading, setDismissed])
}

function add(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  return set.has(id) ? set : new Set([...set, id])
}
