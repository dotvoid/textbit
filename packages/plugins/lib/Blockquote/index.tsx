import type { TBComponentProps, TBOwnElementComponentProps, TBPluginDefinition } from '@dotvoid/textbit'
import { BlockquoteIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { hotkeyOption } from '../shared/hotkey'
import { insertBlockAfterCaret, textNode } from '../shared/insertBlock'

const TYPE = 'core/blockquote'

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

/** A quotation with its source. The source is optional: leave it empty. */
export const Blockquote = (options: BlockquoteOptions = {}): TBPluginDefinition => {
  const labels = { ...LABELS, ...options.labels }

  return {
    class: 'block',
    name: TYPE,
    actions: [{
      name: 'insert',
      title: labels.title,
      tool: () => <BlockquoteIcon />,
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
    componentEntry: {
      class: 'block',
      component: ({ children }: TBComponentProps) => <figure className='tb-blockquote'>{children}</figure>,
      children: [
        {
          type: 'body',
          class: 'text',
          component: ({ children, element }: TBComponentProps) => (
            <blockquote className='tb-blockquote-body' style={{ position: 'relative', margin: 0 }}>
              <ChildPlaceholder element={element}>{labels.body}</ChildPlaceholder>
              {children}
            </blockquote>
          ),
          constraints: { min: 1, max: 1, allowSoftBreak: true }
        },
        {
          type: 'citation',
          class: 'text',
          // A figcaption must sit directly in its figure, without a wrapping <div>
          asOwnElement: true,
          component: ({ children, element, attributes }: TBOwnElementComponentProps<HTMLElement>) => (
            <figcaption {...attributes} className='tb-blockquote-citation' style={{ position: 'relative' }}>
              <ChildPlaceholder element={element}>{labels.citation}</ChildPlaceholder>
              {children}
            </figcaption>
          ),
          constraints: { min: 1, max: 1, allowBreak: false }
        }
      ]
    }
  }
}
