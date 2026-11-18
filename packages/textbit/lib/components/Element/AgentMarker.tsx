import type { CSSProperties } from 'react'
import { useAgents } from '../../hooks/useAgents'
import { useTextbit } from '../../hooks/useTextbit'
import type { AgentStatus } from '../../types/agentPresence'
import type { TextbitLabels } from '../../contexts/TextbitContext'

/**
 * Marks a block an agent is working on: an outline in its colour and a label
 * with its name and what it does. Shown in read-only editors too. Hidden from
 * screen readers, which would read it as part of the text; useAgents gives a
 * host what to announce.
 */
export function AgentMarker({ blockId }: { blockId?: string }) {
  const agents = useAgents()
  const { labels } = useTextbit()
  const here = blockId ? agents.filter((agent) => agent.status !== 'idle' && agent.blocks.includes(blockId)) : []
  if (!here.length) {
    return null
  }

  const [first] = here
  // The agent's colour, else the theme's, else a violet
  const color = 'var(--tb-agent-color, #7c3aed)'

  return (
    <div
      contentEditable={false}
      aria-hidden
      data-tb='agent-marker'
      data-tb-ui=''
      data-status={first.status}
      style={{
        position: 'absolute',
        inset: -4,
        pointerEvents: 'none',
        borderRadius: 'var(--tb-focus-ring-radius, 5px)',
        outline: `2px dashed ${color}`,
        ...(first.color ? { '--tb-agent-color': first.color } : {})
      } as CSSProperties}
    >
      <span
        data-tb='agent-label'
        style={{
          position: 'absolute',
          insetInlineEnd: 0,
          bottom: '100%',
          padding: '1px 6px',
          borderRadius: 4,
          fontSize: 11,
          lineHeight: '16px',
          whiteSpace: 'nowrap',
          color: 'white',
          background: color,
          userSelect: 'none'
        }}
      >
        {here.map((agent) => label(labels, agent.status, agent.name)).join(', ')}
      </span>
    </div>
  )
}

function label(labels: TextbitLabels, status: AgentStatus, name: string): string {
  const key = status === 'reading' ? 'agentReading' : status === 'writing' ? 'agentWriting' : 'agentThinking'
  return labels[key].replace('{name}', name)
}
