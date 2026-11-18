/**
 * Text a suggestion would add, beside where it goes. Not part of the document
 * until accepted: not editable, left out of copies, hidden from screen
 * readers, which hear the suggestion from the editor's announcer and can act
 * on it in Textbit.Suggestions.
 */
export function SuggestedText({ text, color, stale, replaces, block }: {
  text: string
  color?: string
  stale?: boolean
  /** It replaces the struck text just before it: a little space between them */
  replaces?: boolean
  /** Shown as an inline block, so a strike through around it does not cross it */
  block?: boolean
}) {
  const tint = color || 'var(--tb-agent-color, #7c3aed)'
  return (
    <span
      contentEditable={false}
      aria-hidden
      data-tb='suggested-text'
      data-tb-ui=''
      data-stale={stale ? '' : undefined}
      style={{
        color: tint,
        textDecoration: 'underline',
        textDecorationStyle: 'dotted',
        textDecorationColor: tint,
        opacity: stale ? 0.5 : 1,
        userSelect: 'none',
        whiteSpace: 'pre-wrap',
        ...(replaces ? { marginInlineStart: '0.25em' } : {}),
        ...(block ? { display: 'inline-block' } : {})
      }}
    >
      {text}
    </span>
  )
}
