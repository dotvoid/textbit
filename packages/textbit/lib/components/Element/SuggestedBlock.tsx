import { Element, Node, Text } from 'slate'
import type { ShownSuggestion } from '../../contexts/SuggestionsContext'
import { SuggestionBar } from './SuggestionBar'

/**
 * A block a suggestion would insert, previewed where it would go: its text,
 * field by field, until someone accepts or rejects it. Not part of the
 * document: not editable, left out of copies, hidden from screen readers
 * (Textbit.Suggestions lists it).
 */
export function SuggestedBlock({ shown }: { shown: ShownSuggestion }) {
  const color = shown.suggestion.author.color || 'var(--tb-agent-color, #7c3aed)'
  const lines = shown.node ? texts(shown.node) : []

  return (
    <div
      contentEditable={false}
      data-tb='suggested-block'
      data-tb-ui=''
      data-state={shown.state}
      style={{
        position: 'relative',
        margin: '1.5em 0 0.5em',
        padding: '0.25em 0.5em',
        borderInlineStart: `2px dotted ${color}`,
        color,
        userSelect: 'none',
        whiteSpace: 'pre-wrap'
      }}
    >
      <SuggestionBar shown={shown} style={{ insetInlineEnd: 0 }} />
      <div aria-hidden>
        {lines.map((line, index) => <div key={index}>{line || ' '}</div>)}
      </div>
    </div>
  )
}

/** The text of each text-holding element, or the type of an element without text */
function texts(node: Element): string[] {
  if (node.children.some((child) => Text.isText(child))) {
    return node.class === 'void' ? [`[${node.type.slice(node.type.lastIndexOf('/') + 1)}]`] : [Node.string(node)]
  }
  return node.children.flatMap((child) => Element.isElement(child) ? texts(child) : [])
}
