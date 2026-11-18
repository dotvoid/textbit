import type { TBPluginDefinition } from '@dotvoid/textbit/headless'
import { Editor, Element, Range } from 'slate'
import { hotkeyOption } from '../shared/hotkey'
import { insertBlockAfterCaret, textNode } from '../shared/insertBlock'

export const TYPE = 'base/code-block'

/** Options of `CodeBlock` */
export type CodeBlockOptions = {
  /** Spaces Tab inserts. Default: 2. */
  indentSize?: number
  /** The action's name in menus and for screen readers, e.g. a translation */
  title?: string
  /** Hint in an empty code block */
  placeholder?: string
  /** A shortcut that inserts a code block. None by default. */
  hotkey?: string | false
}

/** A block of preformatted code. Tab indents inside it. */
export const CodeBlock = (options: CodeBlockOptions = {}): TBPluginDefinition => ({
  class: 'block',
  name: TYPE,
  actions: [
    {
      name: 'insert',
      title: options.title ?? 'Code block',
      hotkey: hotkeyOption(options.hotkey),
      visibility: (element) => [true, true, element.type === TYPE],
      handler: ({ editor }) => {
        insertBlockAfterCaret(editor, {
          id: crypto.randomUUID(),
          class: 'block',
          type: TYPE,
          children: [textNode(`${TYPE}/body`)]
        })
      }
    },
    {
      name: 'indent',
      hotkey: 'tab',
      when: inCodeBody,
      visibility: () => [false, false, false],
      handler: ({ editor, event }) => {
        event?.preventDefault()
        editor.insertText(' '.repeat(options.indentSize ?? 2))
      }
    }
  ],
  element: {
    class: 'block',
    schema: { description: 'A block of preformatted code' },
    children: [{
      type: 'body',
      class: 'text',
      schema: { description: 'The code, lines broken by Enter', marks: 'none', inlines: 'none' },
      constraints: {
        min: 1,
        max: 1,
        allowBreak: true,
        allowSoftBreak: false,
        allowExitBreak: false
      }
    }]
  }
})

function inCodeBody(editor: Editor): boolean {
  const { selection } = editor
  if (!selection || !Range.isCollapsed(selection)) {
    return false
  }
  const [entry] = Editor.nodes(editor, { match: (n) => Element.isElement(n) && n.type === `${TYPE}/body` })
  return !!entry
}
