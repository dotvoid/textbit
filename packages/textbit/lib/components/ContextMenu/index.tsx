import { Menu as Root } from './Menu'
import { Group } from './Group'
import { Item } from './Item'

/**
 * A right-click menu: spelling suggestions where a word is misspelled, your
 * own items, and the plugins' actions for where it opened, such as a table's
 * rows and columns. Place it in `Textbit.Editable`; `useContextMenuHints()`
 * says where it opened and on what. Without one, the editor shows its own menu
 * with the plugins' actions.
 *
 * ```tsx
 * <Textbit.ContextMenu.Root>
 *   <Textbit.ContextMenu.Group>
 *     <Textbit.ContextMenu.Item func={(editor) => copy(editor)}>Copy</Textbit.ContextMenu.Item>
 *   </Textbit.ContextMenu.Group>
 * </Textbit.ContextMenu.Root>
 * ```
 */
export const ContextMenu = {
  /**
   * The menu, opened by a right click; see `contextMenu` on `Textbit.Editable`
   * for where. After your items it lists the plugins' actions for where it opened.
   */
  Root,
  /** A group of items */
  Group,
  /** An item; `func` runs when it is chosen, then focus goes back to the editor */
  Item
}
