import { useContext } from 'react'
import { ContextMenuHintsContext, type ContextMenuHints, type ContextMenuSpellingHints } from './ContextMenuHintsContext'

/**
 * Where the context menu opened and on what: `menu` with its position and the
 * node under the pointer, and `spelling` when it opened on a misspelled word,
 * with its suggestions and `apply(replacement)`. Both are undefined while it
 * is closed.
 */
export function useContextMenuHints(): {
  /** Where the menu opened, and on what; undefined while it is closed */
  menu?: ContextMenuHints
  /** The misspelled word it opened on, if any */
  spelling?: ContextMenuSpellingHints
} {
  const context = useContext(ContextMenuHintsContext)
  if (context === undefined) {
    throw new Error('useContextMenu must be used within a ContextMenuContextProvider')
  }

  return {
    menu: context.menu,
    spelling: context.spelling
  }
}
