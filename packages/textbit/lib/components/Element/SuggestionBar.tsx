import type { CSSProperties } from 'react'
import { useTextbit } from '../../hooks/useTextbit'
import { useSuggestions } from '../../hooks/useSuggestions'
import type { ShownSuggestion } from '../../contexts/SuggestionsContext'

/**
 * Who suggests a block's change, and Accept and Reject for it, at the block's
 * edge. Read-only editors show who, not the buttons. A suggestion whose block
 * changed since can only be rejected. Not part of the document.
 */
export function SuggestionBar({ shown, style }: { shown: ShownSuggestion, style?: CSSProperties }) {
  const { labels, readOnly } = useTextbit()
  const { accept, reject } = useSuggestions()
  const { suggestion, block, state, formatting } = shown
  const color = suggestion.author.color || 'var(--tb-agent-color, #7c3aed)'
  const from = labels.suggestionFrom.replace('{name}', suggestion.author.name)
  const notes = [state === 'stale' ? labels.suggestionStale : '', formatting ? labels.suggestionFormatting : ''].filter(Boolean)

  // Buttons act on mouse down's click, without taking the caret from the text
  const keep = (event: React.MouseEvent) => event.preventDefault()

  return (
    <div
      contentEditable={false}
      data-tb='suggestion-bar'
      data-tb-ui=''
      data-state={state}
      style={{
        position: 'absolute',
        insetInlineEnd: 0,
        bottom: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        color,
        ...style
      }}
    >
      <span data-tb='suggestion-from'>{from}{notes.length ? ` · ${notes.join(', ')}` : ''}</span>
      {!readOnly && (
        <>
          {state === 'ready' && (
            <button
              type='button'
              data-tb='suggestion-accept'
              aria-label={`${labels.suggestionAccept}: ${from}`}
              onMouseDown={keep}
              onClick={() => accept(suggestion.id, block.id)}
            >
              {labels.suggestionAccept}
            </button>
          )}
          <button
            type='button'
            data-tb='suggestion-reject'
            aria-label={`${labels.suggestionReject}: ${from}`}
            onMouseDown={keep}
            onClick={() => reject(suggestion.id, block.id)}
          >
            {labels.suggestionReject}
          </button>
        </>
      )}
    </div>
  )
}
