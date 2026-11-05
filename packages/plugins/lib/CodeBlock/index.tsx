import type { TBComponentProps, TBPluginDefinition } from '@dotvoid/textbit'
import { Editor, Element, Range } from 'slate'
import { CodeBlockIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { hotkeyOption } from '../shared/hotkey'
import { insertBlockAfterCaret, textNode } from '../shared/insertBlock'

const TYPE = 'core/code-block'

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
      tool: () => <CodeBlockIcon />,
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
  componentEntry: {
    class: 'block',
    component: ({ children }: TBComponentProps) => <div className='tb-code-block'>{children}</div>,
    children: [{
      type: 'body',
      class: 'text',
      component: ({ children, element }: TBComponentProps) => (
        <pre className='tb-code-block-body' style={{ position: 'relative', margin: 0, whiteSpace: 'pre-wrap' }}>
          <ChildPlaceholder element={element}>{options.placeholder}</ChildPlaceholder>
          <code>{children}</code>
        </pre>
      ),
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
