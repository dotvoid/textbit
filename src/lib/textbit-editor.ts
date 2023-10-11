import { Element as SlateElement, Editor as SlateEditor, Node, ExtendedType, NodeEntry, Editor, EditorInterface } from "slate"
import { TextbitElement } from "./textbit-element"

interface TextbitEditorInterface extends EditorInterface {
  position: (editor: SlateEditor) => number
  length: (editor: SlateEditor) => number
  parents: <T extends Node>(editor: SlateEditor) => Generator<NodeEntry<T>, void, undefined>
}
export declare type TextbitEditor = TextbitEditorInterface

export const TextbitEditor: TextbitEditor = {
  ...SlateEditor,

  /** Return start position of the starting element of the current selection (collapsed or not collapsed) in the editor */
  position: (editor: SlateEditor): number => {
    const { selection } = editor

    if (!selection) {
      return -1
    }

    const range = SlateEditor.unhangRange(editor, selection)
    return (range && range.anchor.path.length) ? range.anchor.path[0] : -1
  },

  /** Return number of top level elements in editor */
  length: (editor: SlateEditor): number => {
    return Array.from(
      SlateEditor.nodes(editor, {
        at: [],
        mode: 'highest',
        match: n => SlateElement.isElement(n)
      })).length
  },

  /** Return an iterator of all top level elements in editor */
  parents: (editor: SlateEditor) => {
    return SlateEditor.nodes(editor, {
      at: [],
      mode: 'highest',
      match: n => SlateElement.isElement(n)
    })
  }
}


