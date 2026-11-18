/**
 * The agent's name above the first of its changes in a block, like the name
 * on a collaborator's cursor, in its colour. Fades with the change. Not part
 * of the document: left out of copies and hidden from screen readers.
 */
export function AgentTag({ name, color, fading }: { name: string, color?: string, fading?: boolean }) {
  return (
    <span
      contentEditable={false}
      aria-hidden
      data-tb='agent-tag'
      data-tb-ui=''
      data-fading={fading ? '' : undefined}
      style={{
        position: 'absolute',
        insetInlineStart: 0,
        bottom: '100%',
        padding: '0 4px',
        borderRadius: 3,
        fontSize: 10,
        lineHeight: '14px',
        whiteSpace: 'nowrap',
        color: 'white',
        background: color || 'var(--tb-agent-color, #7c3aed)',
        opacity: fading ? 0 : 0.9,
        pointerEvents: 'none',
        userSelect: 'none'
      }}
    >
      {name}
    </span>
  )
}
