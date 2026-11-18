import { Element, Node } from 'slate'
import { useSlateStatic } from 'slate-react'
import { useSuggestionPlacement } from '../hooks/useSuggestions'
import { useTextbit } from '../hooks/useTextbit'
import type { ShownSuggestion } from '../contexts/SuggestionsContext'
import type { SuggestedBlock } from '../suggestions/types'

/**
 * The suggestions in the document as a list, each block with what it does
 * and its Accept and Reject, and each suggestion with Accept all and Reject
 * all. What keyboard and screen reader users review with: the marks in the
 * text are for the eye. Place it inside Textbit.Root; it renders nothing
 * while there are none.
 */
export function Suggestions({ className, 'aria-label': label = 'Suggestions' }: { className?: string, 'aria-label'?: string }) {
  const { suggestions, onBlock, after, accept, reject } = useSuggestionPlacement()
  const { labels, readOnly } = useTextbit()
  const editor = useSlateStatic()
  if (!suggestions.length) {
    return null
  }

  const inserted = new Map([...after.values()].flat().map((shown) => [shown.block.id, shown]))
  const shownFor = (block: SuggestedBlock) => block.kind === 'insert' ? inserted.get(block.id) : onBlock.get(block.id)

  return (
    <section className={className} data-tb='suggestions' aria-label={label}>
      {suggestions.map((suggestion) => (
        <div key={suggestion.id} data-tb='suggestion' role='group' aria-label={labels.suggestionFrom.replace('{name}', suggestion.author.name)}>
          <p data-tb='suggestion-from'>{labels.suggestionFrom.replace('{name}', suggestion.author.name)}</p>
          <ul>
            {suggestion.blocks.map((block) => {
              const shown = shownFor(block)
              const what = describe(editor, block, shown)
              const stale = shown?.state === 'stale'
              return (
                <li key={block.id} data-tb='suggestion-item' data-state={stale ? 'stale' : 'ready'}>
                  <span>{what}{stale ? ` (${labels.suggestionStale})` : ''}</span>
                  {!readOnly && (
                    <>
                      {!stale && (
                        <button type='button' aria-label={`${labels.suggestionAccept}: ${what}`} onClick={() => accept(suggestion.id, block.id)}>
                          {labels.suggestionAccept}
                        </button>
                      )}
                      <button type='button' aria-label={`${labels.suggestionReject}: ${what}`} onClick={() => reject(suggestion.id, block.id)}>
                        {labels.suggestionReject}
                      </button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
          {!readOnly && suggestion.blocks.length > 1 && (
            <p data-tb='suggestion-all'>
              <button type='button' onClick={() => accept(suggestion.id)}>{labels.suggestionAccept} ({suggestion.blocks.length})</button>
              <button type='button' onClick={() => reject(suggestion.id)}>{labels.suggestionReject} ({suggestion.blocks.length})</button>
            </p>
          )}
        </div>
      ))}
    </section>
  )
}

/** What a block of a suggestion does, in words */
function describe(editor: ReturnType<typeof useSlateStatic>, block: SuggestedBlock, shown?: ShownSuggestion): string {
  const quote = (text: string) => `“${text.length > 60 ? `${text.slice(0, 60)}…` : text}”`
  if (block.kind === 'insert') {
    return `Add ${quote(Node.string(block.node))}`
  }
  const current = editor.children.find((node) => Element.isElement(node) && node.id === block.id)
  if (block.kind === 'delete') {
    return `Delete ${quote(current ? Node.string(current) : '')}`
  }
  const words = [...shown?.texts?.values() ?? []].flat().map((change) => change.removed && change.added
    ? `${quote(change.removed)} to ${quote(change.added)}`
    : change.added ? `add ${quote(change.added)}` : `remove ${quote(change.removed)}`)
  return words.length ? `Change ${words.join(', ')}` : 'Change formatting'
}
