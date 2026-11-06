import { ContextMenu, useAction, useContextMenuHints } from '@dotvoid/textbit'

/**
 * The right-click menu: spelling suggestions on a marked word, with a way to
 * accept the word in this document, and inserting a special character.
 */
export const EditorContextMenu = ({ onAccept }: {
  onAccept?: (word: string, accept: boolean) => void
}) => {
  const { spelling } = useContextMenuHints()
  const openSpecialCharacters = useAction('core/specialchars', 'open')

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
      {openSpecialCharacters && (
        <ContextMenu.Group>
          <ContextMenu.Item func={() => openSpecialCharacters()}>Insert special character…</ContextMenu.Item>
        </ContextMenu.Group>
      )}
    </ContextMenu.Root>
  )
}
