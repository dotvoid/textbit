import { Editor, Element, Node, Point, Range, Text, type Descendant } from 'slate'
import { TEXT_TYPE } from './textType'

/** The clipboard format listing the element types the copying editor renders */
export const TEXTBIT_TYPES_FORMAT = 'application/x-textbit-types'

/**
 * What a copy, cut or drag of the current selection carries.
 *
 * A non-text block the selection covers from start to end is carried as the
 * block. One it covers only partly carries its text alone: a paragraph per
 * text field with text selected in it, formatting and inline elements kept,
 * none of the block's type, properties or voids. A collapsed selection in a
 * void, or one touching a top-level void, carries that whole block.
 */
export function clipboardFragment(editor: Editor): Descendant[] {
  const { selection } = editor
  if (!selection) {
    return []
  }

  if (Range.isCollapsed(selection)) {
    const top = editor.children[selection.anchor.path[0]]
    return top && Editor.void(editor, { at: selection }) ? [top] : []
  }

  const [start, end] = Range.edges(selection)
  const first = start.path[0]

  return Editor.fragment(editor, selection).flatMap((node, i) => {
    const index = first + i
    const block = editor.children[index]
    if (!Element.isElement(node) || node.class === 'text' || !Element.isElement(block)) {
      return [node]
    }

    // A void, such as an object whose plugin is missing, is never partly covered
    if (Editor.isVoid(editor, block)) {
      return [block]
    }

    const whole = !Point.isAfter(start, Editor.start(editor, [index]))
      && !Point.isBefore(end, Editor.end(editor, [index]))

    return whole ? [node] : textFields(editor, node)
  })
}

/**
 * A paragraph per text field with text in it, from a partly copied block. A
 * text element holding elements, such as a list of items, gives a paragraph
 * per item: the items are the fields.
 */
function textFields(editor: Editor, node: Element): Descendant[] {
  const paragraphs: Descendant[] = []

  const walk = (current: Element) => {
    for (const child of current.children) {
      if (!Element.isElement(child) || Editor.isVoid(editor, child)) {
        continue
      }
      if (child.class === 'text' && child.children.every(isTextContent)) {
        if (Node.string(child).length) {
          paragraphs.push(paragraph(child.children))
        }
      } else {
        walk(child)
      }
    }
  }

  walk(node)
  return paragraphs
}

/** Text, or an inline element: what a text field holds */
function isTextContent(node: Descendant): boolean {
  return Text.isText(node) || (Element.isElement(node) && node.class === 'inline')
}

/** The source editor's types from a clipboard, or null when absent or invalid */
export function decodeTextbitTypes(data: DataTransfer): Set<string> | null {
  try {
    const raw = data.getData(TEXTBIT_TYPES_FORMAT)
    if (!raw) {
      return null
    }
    const types: unknown = JSON.parse(raw)
    return Array.isArray(types) && types.every((t) => typeof t === 'string')
      ? new Set(types)
      : null
  } catch {
    return null
  }
}

/**
 * Turn pasted elements this editor cannot render into text.
 *
 * An element whose type is not registered here is converted only when the
 * editor it was copied from could render it (it is in `sourceTypes`), or when
 * that is unknown (`sourceTypes` null: an older clipboard or another
 * application). Otherwise it was unknown there too and is kept as it is.
 *
 * Converted, at any depth: a void is dropped; an element holding only text
 * and inline elements becomes a paragraph of them, with unregistered inline
 * elements replaced by their text and marks kept; any other element is
 * replaced by its converted children.
 */
export function convertUnregistered(
  nodes: Descendant[],
  registered: Set<string>,
  sourceTypes: Set<string> | null
): Descendant[] {
  const converts = (element: Element) => !registered.has(element.type)
    && (sourceTypes === null || sourceTypes.has(element.type))

  const inlineChildren = (children: Descendant[]): Descendant[] => children.flatMap((child): Descendant[] => {
    if (!Element.isElement(child)) {
      return [child]
    }
    if (child.class === 'inline' && converts(child)) {
      return leaves(child)
    }
    return convertNode(child)
  })

  const convertNode = (node: Descendant): Descendant[] => {
    if (!Element.isElement(node)) {
      return [node]
    }

    if (!converts(node)) {
      if (!registered.has(node.type)) {
        return [node]
      }
      const children = node.class === 'text'
        ? inlineChildren(node.children)
        : node.children.flatMap(convertNode)
      return [{ ...node, children: children.length ? children : [{ text: '' }] } as Descendant]
    }

    if (node.class === 'void') {
      return []
    }
    if (node.class === 'inline') {
      return leaves(node)
    }
    if (node.children.every(isTextContent)) {
      // An empty field adds nothing, as when copying part of an object
      const children = inlineChildren(node.children)
      return children.every((c) => Text.isText(c) && c.text === '') ? [] : [paragraph(children)]
    }
    return node.children.flatMap(convertNode)
  }

  return wrapLooseText(nodes.flatMap(convertNode))
}

/** The text leaves of an element, marks kept */
function leaves(element: Element): Descendant[] {
  return element.children.flatMap((child): Descendant[] => {
    return Element.isElement(child) ? leaves(child) : [child]
  })
}

/** Text and inline elements left at the top level go in paragraphs */
function wrapLooseText(nodes: Descendant[]): Descendant[] {
  const result: Descendant[] = []
  let run: Descendant[] = []

  const flush = () => {
    if (run.length) {
      result.push(paragraph(run))
      run = []
    }
  }

  for (const node of nodes) {
    if (Text.isText(node) || (Element.isElement(node) && node.class === 'inline')) {
      run.push(node)
    } else {
      flush()
      result.push(node)
    }
  }
  flush()

  return result
}

function paragraph(children: Descendant[]): Descendant {
  return {
    id: crypto.randomUUID(),
    type: TEXT_TYPE,
    class: 'text',
    properties: {},
    children: children.length ? children : [{ text: '' }]
  } as Descendant
}
