import type { TBComponentProps, TBOwnElementComponentProps, TBPlugin } from '@dotvoid/textbit'
import { BlockquoteIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { Blockquote as BlockquoteDefinition, blockquoteLabels, TYPE, type BlockquoteOptions } from './definition'

export type { BlockquoteOptions, BlockquoteLabels } from './definition'

/** A quotation with its source. The source is optional: leave it empty. */
export const Blockquote = (options: BlockquoteOptions = {}): TBPlugin => {
  const labels = blockquoteLabels(options)

  return {
    ...BlockquoteDefinition(options),
    view: {
      components: {
        [TYPE]: {
          component: ({ children }: TBComponentProps) => <figure className='tb-blockquote'>{children}</figure>
        },
        [`${TYPE}/body`]: {
          component: ({ children, element }: TBComponentProps) => (
            <blockquote className='tb-blockquote-body' style={{ position: 'relative', margin: 0 }}>
              <ChildPlaceholder element={element}>{labels.body}</ChildPlaceholder>
              {children}
            </blockquote>
          )
        },
        [`${TYPE}/citation`]: {
          // A figcaption must sit directly in its figure, without a wrapping <div>
          asOwnElement: true,
          component: ({ children, element, attributes }: TBOwnElementComponentProps<HTMLElement>) => (
            <figcaption {...attributes} className='tb-blockquote-citation' style={{ position: 'relative' }}>
              <ChildPlaceholder element={element}>{labels.citation}</ChildPlaceholder>
              {children}
            </figcaption>
          )
        }
      },
      tools: { insert: () => <BlockquoteIcon /> }
    }
  }
}
