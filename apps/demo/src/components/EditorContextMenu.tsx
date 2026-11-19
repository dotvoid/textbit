import { Range } from 'slate'
import { useSlateSelection } from 'slate-react'
import { ContextMenu, useAction, useComments, useContextMenuHints } from '@dotvoid/textbit'

/**
 * The right-click menu: spelling suggestions on a marked word, with a way to
 * accept the word in this document, commenting on the selection, and
 * inserting a special character. The plugins' actions for where it opened,
 * such as a table's, come first on their own.
 */
export const EditorContextMenu = ({ onAccept, onComment }: {
  onAccept?: (word: string, accept: boolean) => void
  /** Opens the box for a new comment on the selection */
  onComment?: () => void
}) => {
  const { spelling } = useContextMenuHints()
  const openSpecialCharacters = useAction('core/specialchars', 'open')
  const { rights } = useComments()
  const selection = useSlateSelection()
  const canComment = !!onComment && rights !== 'none' && !!selection && Range.isExpanded(selection)

  return (
    <ContextMenu.Root>
      {spelling && (
        <ContextMenu.Group>
          {spelling.suggestions.map(({ text, description }) => (
            <ContextMenu.Item key={text} func={() => spelling.apply(text)}>
              {description ? `${text} (${description})` : text}
            </ContextMenu.Item>
          ))}
          {!spelling.suggestions.length && <ContextMenu.Item>No suggestions</ContextMenu.Item>}
        </ContextMenu.Group>
      )}
      {spelling && onAccept && (
        <ContextMenu.Group>
          <ContextMenu.Item func={() => onAccept(spelling.text, !spelling.accepted)}>
            {spelling.accepted ? `Stop accepting “${spelling.text}”` : `Accept “${spelling.text}” here`}
          </ContextMenu.Item>
        </ContextMenu.Group>
      )}
      {canComment && (
        <ContextMenu.Group>
          <ContextMenu.Item func={() => onComment()}>Comment…</ContextMenu.Item>
        </ContextMenu.Group>
      )}
      {openSpecialCharacters && (
        <ContextMenu.Group>
          <ContextMenu.Item func={() => openSpecialCharacters()}>Insert special character…</ContextMenu.Item>
        </ContextMenu.Group>
      )}
    </ContextMenu.Root>
  )
}
