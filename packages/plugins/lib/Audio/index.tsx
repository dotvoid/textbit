import type { TBComponentProps, TBOwnElementComponentProps, TBPlugin } from '@dotvoid/textbit'
import { Element, Node } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { AudioQuoteIcon } from '../shared/icons'
import { FieldContent } from '../shared/Field'
import { safeMediaSrc } from '../shared/media'
import { Audio as AudioDefinition, TYPE, labelsOf, type AudioLabels, type AudioOptions } from './definition'

export type { AudioOptions, AudioLabels } from './definition'

/** An audio player with a caption. A reference for your own, like Image, under your own namespace. */
export const Audio = (options: AudioOptions = {}): TBPlugin => {
  const labels = labelsOf(options)

  return {
    ...AudioDefinition(options),
    view: {
      components: {
        [TYPE]: {
          component: ({ children }: TBComponentProps) => <figure className='tb-audio'>{children}</figure>
        },
        [`${TYPE}/content`]: {
          component: (props: TBComponentProps) => <AudioContent {...props} labels={labels} />
        },
        [`${TYPE}/caption`]: {
          // A figcaption must sit directly in its figure, without a wrapping <div>
          asOwnElement: true,
          component: ({ children, element, attributes }: TBOwnElementComponentProps<HTMLElement>) => (
            <figcaption {...attributes} className='tb-field tb-audio-caption'>
              <FieldContent element={element} label={labels.caption} hint={labels.captionHint}>{children}</FieldContent>
            </figcaption>
          )
        }
      },
      tools: { insert: () => <AudioQuoteIcon /> }
    }
  }
}


function AudioContent({ element, children, labels }: TBComponentProps & { labels: AudioLabels }) {
  const editor = useSlateStatic()
  const figure = Node.get(editor, ReactEditor.findPath(editor, element).slice(0, -1))
  const properties = Element.isElement(figure) ? figure.properties ?? {} : {}
  const src = safeMediaSrc(properties.src)
  const title = typeof properties.title === 'string' ? properties.title : undefined

  // A void element must render its children: the hidden spacer Slate puts the
  // caret on (see Image)
  return (
    <>
      <div className='tb-audio-content' contentEditable={false}>
        {src
          ? <audio controls preload='metadata' src={src} aria-label={title} style={{ width: '100%' }} />
          : <div className='tb-audio-missing'>{labels.missing}</div>}
      </div>
      {children}
    </>
  )
}
