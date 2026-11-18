/**
 * Text an agent removed, struck through where it was. Not part of the
 * document: not editable, skipped by the caret and left out of copies
 * (data-tb-ui), and hidden from screen readers, which hear the change as a
 * sentence from the editor's announcer instead.
 */
export function AgentRemoved({ text, color, fading }: { text: string, color?: string, fading?: boolean }) {
  return (
    <span
      contentEditable={false}
      aria-hidden
      data-tb='agent-removed'
      data-tb-ui=''
      data-fading={fading ? '' : undefined}
      style={{
        textDecoration: 'line-through',
        textDecorationColor: color || 'var(--tb-agent-color, #7c3aed)',
        opacity: fading ? 0 : 0.6,
        userSelect: 'none'
      }}
    >
      {text}
    </span>
  )
}
