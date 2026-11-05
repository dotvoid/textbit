import type { TBConsumeFunction } from '@dotvoid/textbit'
import { type BaseRange, Editor, Node, Path, Text, Transforms } from 'slate'

const LOCALIZED_QUOTES: Record<string, string[]> = {
  sv: ['’', '’', '”', '”'],
  fi: ['’', '’', '”', '”'],
  hu: ['’', '’', '„', '”'],
  pl: ['‚', '’', '„', '”'],
  no: ['‹', '›', '«', '»'],
  en: ['‘', '’', '“', '”'],
  da: ['„', '“', '„', '“'],
  de: ['‚', '‘', '„', '“'],
  fr: ['‹ ', ' ›', '« ', ' »']
}

const LOCALIZED_DASH_PREFIX: Record<string, string> = {
  sv: '–'
}

const KEY_CODES = [
  9,  // tab
  32, // space
  60, // non breaking space
  33, // !
  40, // (
  41, // )
  43, // +
  44, // ,
  45, // -
  46, // .
  47, // /
  58, // :
  59, // ;
  60, // <
  61, // =
  62, // >
  63  // ?
]

export const consume: TBConsumeFunction = async ({ editor, input }) => {
  const { selection } = editor
  const lang = editor.lang.substring(0, 2).toLowerCase()

  if (Array.isArray(input) || typeof input.data !== 'string') {
    return
  }

  if (!selection || selection.anchor.path.length < 2) {
    return
  }

  const { data } = input

  if (data[0] === '-' && LOCALIZED_DASH_PREFIX[lang]) {
    if (isFirstCharacterOfFirstChild(editor, selection)) {
      return {
        ...input,
        data: LOCALIZED_DASH_PREFIX[lang] + data.slice(1)
      }
    }
  }

  // If input is a dash immediately following a preceding dash, turn them into a long dash
  if (data[0] === '-') {
    const { anchor } = selection
    const before = Editor.before(editor, anchor, { unit: 'character' })

    if (before) {
      const [node] = Editor.node(editor, before.path)

      if (Text.isText(node)) {
        const text = node.text
        const charBefore = text[before.offset]

        if (charBefore === '-') {
          Transforms.delete(editor, { at: before })
          return {
            ...input,
            data: '–'
          }
        }
      }
    }
  }

  // Walk the sibling text leaves of the current text node. The current text
  // node lives at selection.anchor.path; its parent block is the path with
  // the last index dropped. Hard-coding depth 2 here fails when the text is
  // nested deeper, e.g. inside a factbox embedded in an article.
  // (Mirrors ttab/textbit-plugins PR #479.)
  const parentPath = Path.parent(selection.anchor.path)
  const startIndex = selection.anchor.path[selection.anchor.path.length - 1]
  let firstOffset = selection.anchor.offset
  let point
  let prevChar: string = ''

  // From anchor inline node and backwards
  for (let pos = startIndex; pos >= 0; pos--) {
    const [node, path] = Editor.node(editor, [...parentPath, pos])
    if (!Text.isText(node)) {
      continue
    }

    for (let offset = firstOffset || node.text.length - 1; offset >= 0; offset--) {
      if (point) {
        // If the char before the inch/foot mark is a number and the char after
        // is whitespace/punctuation, treat as actual inch/foot mark and bail.
        const char = node.text[offset]
        if (!isNaN(parseInt(char)) && KEY_CODES.includes(prevChar.charCodeAt(0))) {
          return input
        }

        // Found a matching inch/foot - convert to typographic quotation.
        pos = -1
        break
      }

      if (node.text[offset] === data) {
        point = { path, offset }
      } else {
        prevChar = node.text[offset]
      }
    }

    firstOffset = 0
  }

  if (!point) {
    return input
  }

  const q = LOCALIZED_QUOTES[lang] || LOCALIZED_QUOTES.en

  let quotes: string[] = []
  if (data === '\'') {
    quotes = [q[0], q[1]]
  } else if (data === '"') {
    quotes = [q[2], q[3]]
  } else {
    return input
  }

  Transforms.delete(editor, { at: point })
  Transforms.insertText(editor, quotes[0], { at: point })

  return {
    ...input,
    data: quotes[1]
  }
}

function isFirstCharacterOfFirstChild(editor: Editor, selection: BaseRange): boolean {
  const { anchor } = selection

  if (anchor.path.length < 2) {
    return false
  }

  // Find the first text descendant of the block containing the cursor.
  // The block is the parent of the current text node; walking up from
  // anchor.path keeps this correct at any nesting depth.
  // (Mirrors ttab/textbit-plugins PR #479.)
  const blockPath = Path.parent(anchor.path)
  const firstTextEntry = Node.first(editor, blockPath)
  if (!firstTextEntry) {
    return false
  }

  const [firstTextNode, firstTextPath] = firstTextEntry

  if (!Text.isText(firstTextNode)) {
    return false
  }

  return Path.equals(anchor.path, firstTextPath) && anchor.offset === 0
}
