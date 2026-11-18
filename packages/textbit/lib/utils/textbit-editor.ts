import {
  Editor,
  Element,
  Node,
  Text,
  Transforms,
  Range,
  type EditorNodesOptions,
  type NodeEntry,
  type EditorInterface,
  type BaseRange,
  type Descendant,
} from 'slate'
import { TextbitElement } from './textbit-element'
import { TEXT_TYPE } from './textType'

/** Slate's `Editor` functions, and textbit's; see `TextbitEditor` */
export interface TextbitEditorInterface extends EditorInterface {
  /** The index of the top-level block the selection starts in, or -1 without a selection */
  position: (editor: Editor) => number
  /** How many top-level blocks the document has */
  length: (editor: Editor) => number
  /** The top-level blocks, as Slate node entries */
  parents: (editor: Editor, options?: EditorNodesOptions<Element>) => Generator<NodeEntry<Element>, void, undefined>
  /** The text nodes in the selection */
  selectedTextEntries: (editor: Editor) => NodeEntry<Node>[]
  /** Whether the selection includes an element of a type */
  includes: (editor: Editor, type: string) => boolean
  /** The text of a range, or of the selection */
  getSelectedText: (editor: Editor, range?: BaseRange) => string | undefined
  /**
   * Replace the occurrence of a text the caret is in with another, as a
   * spelling correction from the context menu does
   */
  replaceStringAtPosition: (editor: Editor, targetString: string, replacementString: string) => void
  /** Insert one or more nodes as top-level blocks at an index */
  insertAt: (editor: Editor, position: number, nodes: Node | Node[]) => void
  /** Whether any of the nodes holds text other than whitespace: useful in normalizers */
  hasText: (nodes: NodeEntry<Descendant>[]) => boolean
  /**
   * Turn the top-level text blocks in the selection into text of a type and
   * role, as the paragraph and heading actions do. Blocks of core's text type
   * (`base/text`) keep it and only get the role; other text blocks become
   * `type`, with their text kept as plain text, and the caret moves to their
   * start. Objects are left as they are. `nodes` is not used.
   */
  convertToTextNode: (editor: Editor, type: string, role?: string, nodes?: NodeEntry<Node>[]) => void
}

/**
 * Slate's `Editor` functions, with textbit's helpers for the document's
 * top-level blocks and text.
 *
 * ```ts
 * TextbitEditor.position(editor) // index of the block at the selection
 * ```
 */
export const TextbitEditor: TextbitEditorInterface = {
  ...Editor,

  /** Return start position of the starting element of the current selection (collapsed or not collapsed) in the editor */
  position: (editor): number => {
    const { selection } = editor

    if (!selection) {
      return -1
    }

    const range = Editor.unhangRange(editor, selection)
    return (range && range.anchor.path.length) ? range.anchor.path[0] : -1
  },

  /** Return number of top level elements in editor */
  length: (editor): number => {
    return Array.from(
      Editor.nodes(editor, {
        at: [],
        mode: 'highest',
        match: (n) => Element.isElement(n)
      })).length
  },

  /** Return an iterator of all top level elements in editor */
  parents: (editor) => {
    return Editor.nodes(editor, {
      at: [],
      mode: 'highest',
      match: (n) => Element.isElement(n)
    })
  },

  /** Return all text nodes in current selection */
  selectedTextEntries: (editor) => {
    if (!Range.isRange(editor.selection)) {
      return []
    }

    const nodeItr = Editor.nodes(editor, {
      at: editor.selection,
      match: (node) => {
        return Text.isText(node)
      }
    })

    return Array.from(nodeItr)
  },

  /**
   * Check if selection includes specified element type.
   *
   * @param editor
   * @param type
   * @returns boolean
   */
  includes: (editor, type) => {
    const { selection } = editor

    if (!selection) {
      return false
    }

    const [match] = Array.from(
      Editor.nodes(editor, {
        at: Editor.unhangRange(editor, selection),
        match: (node) =>
          !Editor.isEditor(node)
          && Element.isElement(node)
          && node.type === type
      })
    )

    return !!match
  },

  /**
   * Get selected text either from selected text in editor or from a range in an editor
   *
   * @param editor Editor
   * @param range  Optional Range
   * @returns string
   */
  getSelectedText: (editor, range) => {
    const useRange = range || Editor.unhangRange(editor, editor.selection as BaseRange)
    return Editor.string(editor, useRange)
  },

  /**
   * Replace a given target string with another string if cursor is placed in
   * the given target string. Useful for replacing misspelled words on context clicks.
   *
   * @param editor - A slate editor instance
   * @param targetString - The string to replace
   * @param replacementString - The string to replace with
   */
  replaceStringAtPosition: (editor, targetString, replacementString) => {
    // Check if we have a selection
    if (!editor.selection) {
      return
    }

    // Get the current cursor position
    const cursor = editor.selection.anchor

    // Get the node and path at cursor position
    const [node] = Editor.node(editor, cursor.path)

    // Make sure we're in a text node
    if (!Text.isText(node)) {
      return
    }

    // Find the correct occurrence of the string (could be many)
    let index = cursor.offset - targetString.length // Start search from offset index
    if (index < 0) {
      index = 0
    }
    let targetStart = -1
    let targetEnd = -1

    while ((index = node.text.indexOf(targetString, index)) !== -1) {
      if (cursor.offset >= index && cursor.offset <= index + targetString.length) {
        targetStart = index
        targetEnd = index + targetString.length
        break
      }
      index += 1
    }

    if (targetStart === -1) {
      return
    }

    const range = {
      anchor: { path: cursor.path, offset: targetStart },
      focus: { path: cursor.path, offset: targetEnd }
    }

    // Perform the replacement
    Transforms.insertText(editor, replacementString, {
      at: range
    })
  },

  /**
   * Insert a node at the specified position
   *
   * @param editor Editor
   * @param position number
   * @param nodes Node or Nodes to insert
   * @returns void
   */
  insertAt(editor: Editor, position: number, nodes: Node | Node[]): void {
    const nodeArray: Node[] = Array.isArray(nodes) ? nodes : [nodes]

    if (!nodeArray.length) {
      return
    }

    Transforms.insertNodes(
      editor,
      nodes,
      {
        at: [position]
      }
    )
  },

  /**
   * Check if a list of node entries has text in them. Useful in normalizers.
   *
   * @example
   * const normalizeBlockquote = (editor: Editor, nodeEntry: NodeEntry) => {
   *   const [node, path] = nodeEntry
   *   const children = Array.from(Node.children(editor, path))
   *   const isEmpty = !hasText(children)
   *   // ...
   * }
   *
   * @param nodes
   * @returns
   */
  hasText(nodes) {
    for (const [node] of nodes) {
      for (const textNode of Node.texts(node)) {
        if (textNode[0].text.trim() !== '') {
          return true
        }
      }
    }

    return false
  },

  /**
   * Convert nodes to a specified text node type
   *
   * @todo Allow even when one or several elements are not text/text blocks.
   * @todo Store selection and restore it after transforms
   *
   * @param editor Editor
   * @param type string i.e base/text
   * @param role string e.g heading-1, preamble (or even undefined for body text) - Optional
   */
  convertToTextNode(editor, type, role = undefined) {
    if (!editor.selection) {
      return
    }

    const targetNodes = Array.from(
      Editor.nodes(editor, {
        mode: 'highest',
        at: Editor.unhangRange(editor, editor.selection),
        match: (n) => !Editor.isEditor(n)
      })
    )

    if (!targetNodes.length) {
      return
    }

    Editor.withoutNormalizing(editor, () => {
      for (let n = 0; n < targetNodes.length; n++) {
        const [child, childPath] = targetNodes[n]

        if (!TextbitElement.isOfType(child, TEXT_TYPE) && TextbitElement.isText(child)) {
          const id = child.id
          Transforms.removeNodes(editor, { at: childPath })

          const textContent = Node.string(child)
          Transforms.insertNodes(
              editor,
              {
                id,
                class: 'text',
                type,
                properties: role ? { role } : {},
                children: [{ text: textContent }]
              },
              { at: childPath }
            )
            editor.select({ anchor: { path: childPath.concat(0), offset: 0 }, focus: { path: childPath.concat(0), offset: 0 } })
        } else if (TextbitElement.isOfType(child, TEXT_TYPE)) {
          Transforms.setNodes(
            editor,
            { type: TEXT_TYPE, properties: role ? { role } : {} },
            { at: childPath }
          )
        }
      }
    })
  }
}
