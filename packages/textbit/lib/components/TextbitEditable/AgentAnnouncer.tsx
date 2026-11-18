import { useEffect, useRef, useState } from 'react'
import { useAgentChanges } from '../../hooks/useAgentChanges'
import { useTextbit } from '../../hooks/useTextbit'
import type { TextbitLabels } from '../../contexts/TextbitContext'
import type { ResolvedAgentChange } from '../../utils/agentChanges'

/**
 * Says what agents change, for screen readers: the marks in the text are
 * hidden from them, as they would be read as part of it. Polite, and only for
 * changes it has not said before.
 */
export function AgentAnnouncer() {
  const { changes } = useAgentChanges()
  const { labels } = useTextbit()
  const said = useRef(new Set<string>())
  const [message, setMessage] = useState('')

  useEffect(() => {
    const fresh = changes.filter((change) => !said.current.has(change.id))
    if (!fresh.length) {
      return
    }
    fresh.forEach((change) => said.current.add(change.id))
    setMessage(fresh.slice(0, 3).map((change) => describe(labels, change)).join('. '))
  }, [changes, labels])

  return (
    <div
      role='status'
      aria-live='polite'
      data-tb='agent-announcer'
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        margin: -1,
        padding: 0,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0
      }}
    >
      {message}
    </div>
  )
}

function describe(labels: TextbitLabels, change: ResolvedAgentChange): string {
  const label = change.added && change.removed
    ? labels.agentReplaced
    : change.added ? labels.agentAdded : labels.agentDeleted
  return label
    .replace('{name}', change.name)
    .replace('{added}', short(change.added))
    .replace('{removed}', short(change.removed))
}

function short(text = ''): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}
