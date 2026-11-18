import {
  type Ancestor,
  Element as SlateElement,
  Text as SlateText,
  type ElementInterface
} from 'slate'

/** Slate's `Element` functions, and textbit's; see `TextbitElement` */
export interface TextbitElementInterface extends ElementInterface {
  /** Whether a value is an element of class `block` */
  isBlock: (value: unknown) => value is Ancestor
  /** Whether a value is an element of class `text`; for a Slate text node, see `isTextLeaf` */
  isText: (value: unknown) => value is SlateElement
  /** Whether a value is an element of class `void` */
  isVoid: (value: unknown) => value is SlateElement
  /** Whether a value is an element of class `inline` */
  isInline: (value: unknown) => value is SlateElement
  /** Whether a value is an element of a type */
  isOfType: <T extends SlateElement>(value: unknown, type: string) => value is T
  /** Whether a value is the element with an id */
  hasId: (value: unknown, id: string) => value is SlateElement
  /** Whether a value is a Slate text node */
  isTextLeaf: (value: unknown) => value is SlateText
}

/**
 * Slate's `Element` functions, with checks of textbit's element classes.
 *
 * ```ts
 * if (TextbitElement.isText(node)) { … } // a paragraph, a caption: class text
 * ```
 */
export const TextbitElement: TextbitElementInterface = {
  isTextLeaf: (value: unknown): value is SlateText => {
    return SlateText.isText(value)
  },
  ...SlateElement,
  isBlock: (value: unknown): value is Ancestor => {
    return SlateElement.isAncestor(value) && SlateElement.isElement(value) && value.class === 'block'
  },

  isText: (value: unknown): value is SlateElement => {
    return SlateElement.isElement(value) && value.class === 'text'
  },

  isVoid: (value: unknown): value is SlateElement => {
    return SlateElement.isElement(value) && value.class === 'void'
  },

  isInline: (value: unknown): value is SlateElement => {
    return SlateElement.isElement(value) && value.class === 'inline'
  },

  isOfType: <T extends SlateElement>(value: unknown, type: string): value is T => {
    return SlateElement.isElement(value) && value?.type === type
  },

  hasId: (value: unknown, id: string): value is SlateElement => {
    return SlateElement.isElement(value) && value?.id === id
  }
}
