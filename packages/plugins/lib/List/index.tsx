import type { TBComponentProps, TBOwnElementComponentProps, TBPluginDefinition } from '@dotvoid/textbit'
import { TextbitElement } from '@dotvoid/textbit'
import { Editor, Element, Path, Range, Transforms, type NodeEntry } from 'slate'
import { ListIcon, OrderedListIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { hotkeyOption } from '../shared/hotkey'

const UNORDERED = 'core/unordered-list'
const ORDERED = 'core/ordered-list'
const LIST_TYPES = [UNORDERED, ORDERED]
const ITEM_TYPES = LIST_TYPES.map((type) => `${type}/list-item`)

export type ListOptions = {
  /** The action's name in menus and for screen readers, e.g. a translation */
  title?: string
  /** Hint in an empty list item */
  placeholder?: string
  /**
   * Replace the default shortcut, or remove it with `false`. Defaults, as in
   * Google Docs: Ctrl/⌘+Shift+8 for bullets, Ctrl/⌘+Shift+7 for numbers.
   */
  hotkey?: string | false
}

/** A bullet list. Use it with OrderedList to switch a list between the two. */
export const UnorderedList = (options: ListOptions = {}): TBPluginDefinition =>
  listPlugin(UNORDERED, options.title ?? 'Bullet list', () => <ListIcon />, hotkeyOption(options.hotkey, 'mod+shift+8'), options)

/** A numbered list. Use it with UnorderedList to switch a list between the two. */
export const OrderedList = (options: ListOptions = {}): TBPluginDefinition =>
  listPlugin(ORDERED, options.title ?? 'Numbered list', () => <OrderedListIcon />, hotkeyOption(options.hotkey, 'mod+shift+7'), options)

function listPlugin(
  type: string,
  title: string,
  tool: () => React.ReactNode,
  hotkey: string | undefined,
  options: ListOptions
): TBPluginDefinition {
  return {
    class: 'text',
    name: type,
    actions: [
      {
        name: 'toggle',
        title,
        tool,
        hotkey,
        visibility: (element, innerElement) => {
          const target = innerElement ?? element
          return [
            ['core/text', ...LIST_TYPES, ...ITEM_TYPES].includes(target.type),
            true,
            target.type === type || target.type === `${type}/list-item`
          ]
        },
        handler: ({ editor }) => {
          toggleList(editor, type)
        }
      },
      {
        // Enter on the last item: a new item, or out of the list when it is
        // empty. Elsewhere in a list Slate's own Enter already does the right thing.
        name: 'enter',
        hotkey: 'enter',
        when: (editor) => lastItem(editor, type) !== undefined,
        visibility: () => [false, false, false],
        handler: ({ editor, event }) => {
          event?.preventDefault()
          enterOnLastItem(editor, type)
        }
      }
    ],
    componentEntry: {
      class: 'text',
      component: ListComponent,
      constraints: {
        normalizeNode: (editor: Editor, entry: NodeEntry) => normalizeList(editor, entry, type)
      },
      children: [{
        type: 'list-item',
        class: 'text',
        // Renders the <li> itself: a wrapping <div> is not allowed in a list
        asOwnElement: true,
        component: (props: TBOwnElementComponentProps<HTMLLIElement>) => (
          <ListItemComponent {...props} placeholder={options.placeholder} />
        )
      }]
    }
  }
}

function ListComponent({ element, children }: TBComponentProps) {
  return element.type === ORDERED
    ? <ol className='tb-list tb-ordered-list'>{children}</ol>
    : <ul className='tb-list tb-unordered-list'>{children}</ul>
}

function ListItemComponent({ element, children, attributes, placeholder }: TBOwnElementComponentProps<HTMLLIElement> & { placeholder?: string }) {
  return (
    <li {...attributes} className='tb-list-item' style={{ position: 'relative' }}>
      <ChildPlaceholder element={element}>{placeholder}</ChildPlaceholder>
      {children}
    </li>
  )
}

/** The list item under a collapsed caret, if it is the last item of a list of this type */
function lastItem(editor: Editor, type: string): { itemPath: Path, listPath: Path, list: Element } | undefined {
  const { selection } = editor
  if (!selection || !Range.isCollapsed(selection)) {
    return undefined
  }

  const [entry] = Editor.nodes(editor, {
    at: selection,
    match: (n) => Element.isElement(n) && n.type === `${type}/list-item`
  })
  if (!entry) {
    return undefined
  }

  const itemPath = entry[1]
  const listPath = Path.parent(itemPath)
  const [list] = Editor.node(editor, listPath)
  if (!Element.isElement(list) || itemPath[itemPath.length - 1] !== list.children.length - 1) {
    return undefined
  }
  return { itemPath, listPath, list }
}

function enterOnLastItem(editor: Editor, type: string): void {
  const found = lastItem(editor, type)
  if (!found) {
    return
  }
  const { itemPath, listPath, list } = found

  if (Editor.string(editor, itemPath) !== '') {
    Transforms.splitNodes(editor, {
      match: (n) => Element.isElement(n) && n.type === `${type}/list-item`,
      always: true
    })
    return
  }

  // An empty last item leaves the list, as a paragraph after it. The only item
  // turns the whole list into that paragraph.
  Editor.withoutNormalizing(editor, () => {
    const at = list.children.length === 1 ? listPath : Path.next(listPath)
    Transforms.removeNodes(editor, { at: list.children.length === 1 ? listPath : itemPath })
    Transforms.insertNodes(editor, {
      id: crypto.randomUUID(),
      class: 'text',
      type: 'core/text',
      children: [{ text: '' }]
    }, { at })
    Transforms.select(editor, Editor.start(editor, at))
  })
}

/**
 * In a list of this type: back to paragraphs. In the other list type: switch the
 * whole list. In paragraphs: make them a list.
 */
function toggleList(editor: Editor, type: string): void {
  const { selection } = editor
  if (!selection) {
    return
  }

  const [listEntry] = Editor.nodes(editor, {
    at: Editor.unhangRange(editor, selection),
    match: (n) => Element.isElement(n) && LIST_TYPES.includes(n.type)
  })

  if (listEntry) {
    const [list, listPath] = listEntry as NodeEntry<Element>
    const itemType = `${list.type}/list-item`
    Editor.withoutNormalizing(editor, () => {
      if (list.type === type) {
        Transforms.setNodes(editor, { type: 'core/text', properties: {} },
          { at: listPath, match: (n) => Element.isElement(n) && n.type === itemType })
        Transforms.unwrapNodes(editor, { at: listPath })
      } else {
        Transforms.setNodes(editor, { type: `${type}/list-item` },
          { at: listPath, match: (n) => Element.isElement(n) && n.type === itemType })
        Transforms.setNodes(editor, { type }, { at: listPath })
      }
    })
    return
  }

  Editor.withoutNormalizing(editor, () => {
    Transforms.setNodes(editor, { type: `${type}/list-item`, properties: {} }, {
      match: (n) => !Editor.isEditor(n) && TextbitElement.isElement(n) && n.class === 'text'
    })
    Transforms.wrapNodes(editor, {
      id: crypto.randomUUID(),
      class: 'text',
      type,
      children: []
    })
  })
}

function normalizeList(editor: Editor, [node, path]: NodeEntry, type: string): boolean | undefined {
  if (!Element.isElement(node)) {
    return undefined
  }

  if (node.children.length === 0) {
    Transforms.removeNodes(editor, { at: path })
    return true
  }

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]
    if (TextbitElement.isElement(child) && child.type !== `${type}/list-item`) {
      Transforms.setNodes(editor, { type: `${type}/list-item` }, { at: [...path, i] })
      return true
    }
  }
  return undefined
}
