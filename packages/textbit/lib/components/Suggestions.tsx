import { useSuggestions } from '../hooks/useSuggestions'
import { useTextbit } from '../hooks/useTextbit'
import type { SuggestedChange } from '../suggestions/changes'

/**
 * The suggested changes as a list, each with what it does and who suggested
 * it, Accept and Reject, and Accept all and Reject all. What keyboard and
 * screen reader users review with: the marks in the text are for the eye.
 * Place it inside a `Textbit.Root` showing a fork; it renders nothing while
 * nothing is suggested.
 */
export function Suggestions({ className, people, 'aria-label': label = 'Suggestions' }: {
  className?: string
  /** Names for who suggested, by the key attributions name them with */
  people?: Readonly<Record<string, { name: string }>>
  'aria-label'?: string
}) {
  const { changes, accept, reject, acceptAll, rejectAll } = useSuggestions()
  const { labels, readOnly } = useTextbit()
  if (!changes.length) {
    return null
  }
  const describe = (change: SuggestedChange) => {
    const name = (change.by && people?.[change.by]?.name) || labels.suggestionSomeone
    const template = change.kind === 'replace'
      ? labels.suggestionReplaces
      : change.kind === 'insert' ? labels.suggestionAdds : labels.suggestionRemoves
    return template
      .replace('{name}', name)
      .replace('{added}', quote(change.inserted))
      .replace('{removed}', quote(change.deleted))
  }

  return (
    <section className={className} data-tb='suggestions' aria-label={label}>
      <ul data-tb='suggestion'>
        {changes.map((change) => {
          const what = describe(change)
          return (
            <li key={change.id} data-tb='suggestion-item' data-kind={change.kind}>
              <span>{what}</span>
              {!readOnly && (
                <>
                  <button type='button' aria-label={`${labels.suggestionAccept}: ${what}`} onClick={() => accept(change)}>
                    {labels.suggestionAccept}
                  </button>
                  <button type='button' aria-label={`${labels.suggestionReject}: ${what}`} onClick={() => reject(change)}>
                    {labels.suggestionReject}
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {!readOnly && changes.length > 1 && (
        <p data-tb='suggestion-all'>
          <button type='button' onClick={acceptAll}>{labels.suggestionAcceptAll} ({changes.length})</button>
          <button type='button' onClick={rejectAll}>{labels.suggestionRejectAll} ({changes.length})</button>
        </p>
      )}
    </section>
  )
}

function quote(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}
