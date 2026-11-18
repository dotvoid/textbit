import type { TBPluginDefinition } from '@dotvoid/textbit/headless'
import { hotkeyOption } from '../shared/hotkey'
import { insertBlockAfterCaret, textNode } from '../shared/insertBlock'

export const TYPE = 'base/blockquote'

export type BlockquoteLabels = {
  /** The insert action's name in menus and for screen readers */
  title: string
  body: string
  citation: string
}

export type BlockquoteOptions = {
  labels?: Partial<BlockquoteLabels>
  /** A shortcut that inserts a quote. None by default. */
  hotkey?: string | false
}

const LABELS: BlockquoteLabels = { title: 'Quote', body: 'Quote', citation: 'Source' }

/** The labels, the defaults filled in */
export function blockquoteLabels(options: BlockquoteOptions): BlockquoteLabels {
  return { ...LABELS, ...options.labels }
}

/** A quotation with its source. The source is optional: leave it empty. */
export const Blockquote = (options: BlockquoteOptions = {}): TBPluginDefinition => {
  const labels = blockquoteLabels(options)

  return {
    class: 'block',
    name: TYPE,
    actions: [{
      name: 'insert',
      title: labels.title,
      hotkey: hotkeyOption(options.hotkey),
      visibility: (element) => [true, true, element.type === TYPE],
      handler: ({ editor }) => {
        insertBlockAfterCaret(editor, {
          id: crypto.randomUUID(),
          class: 'block',
          type: TYPE,
          children: [textNode(`${TYPE}/body`), textNode(`${TYPE}/citation`)]
        })
      }
    }],
    element: {
      class: 'block',
      schema: { description: 'A quotation with its source' },
      children: [
        {
          type: 'body',
          class: 'text',
          schema: { description: 'The quoted text' },
          constraints: { min: 1, max: 1, allowSoftBreak: true }
        },
        {
          type: 'citation',
          class: 'text',
          schema: { description: 'Who or what is quoted; may be empty' },
          constraints: { min: 1, max: 1, allowBreak: false }
        }
      ]
    }
  }
}
