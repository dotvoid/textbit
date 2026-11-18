import type { CSSProperties } from 'react'
import { useAgents } from '../../hooks/useAgents'
import { useTextbit } from '../../hooks/useTextbit'

/**
 * Marks a block while an agent writes in it: a thin bar at its edge in the
 * agent's colour, with its name. Light on purpose: people may go on editing
 * there, nothing is locked. What the agent changed shows in the text itself,
 * once it is done. Shown in read-only editors too, left out of copies, and
 * hidden from screen readers, which hear the changes instead.
 */
export function AgentMarker({ blockId }: { blockId?: string }) {
  const agents = useAgents()
  const { labels } = useTextbit()
  const here = blockId ? agents.filter((agent) => agent.status === 'writing' && agent.blocks.includes(blockId)) : []
  if (!here.length) {
    return null
  }

  const [first] = here
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
        top: 0,
        bottom: 0,
        insetInlineStart: -10,
        width: 2,
        borderRadius: 1,
        pointerEvents: 'none',
        background: color,
        ...(first.color ? { '--tb-agent-color': first.color } : {})
      } as CSSProperties}
    >
      <span
        data-tb='agent-label'
        style={{
          position: 'absolute',
          insetInlineEnd: 6,
          top: 0,
          padding: '0 5px',
          borderRadius: 3,
          fontSize: 10,
          lineHeight: '15px',
          whiteSpace: 'nowrap',
          color: 'white',
          background: color,
          userSelect: 'none'
        }}
      >
        {here.map((agent) => labels.agentWriting.replace('{name}', agent.name)).join(', ')}
      </span>
    </div>
  )
}
