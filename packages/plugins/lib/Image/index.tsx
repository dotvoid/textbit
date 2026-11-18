import type { TBComponentProps, TBOwnElementComponentProps, TBPlugin } from '@dotvoid/textbit'
import { Element, Node, type Editor } from 'slate'
import { ReactEditor, useSlateSelector, useSlateStatic } from 'slate-react'
import { ImageIcon } from '../shared/icons'
import { FieldContent } from '../shared/Field'
import { safeMediaSrc } from '../shared/media'
import { Image as ImageDefinition, TYPE, labelsOf, type ImageLabels, type ImageOptions } from './definition'

export type { ImageOptions, ImageLabels } from './definition'

/**
 * An image with a caption and alternative text. Files reach it by drop or from
 * the insert action, and are stored by your `upload` function. Also a reference
 * for building your own, which gets a namespace of your own (`acme/image`, not
 * `base/image`).
 */
export const Image = (options: ImageOptions = {}): TBPlugin => {
  const labels = labelsOf(options)

  return {
    ...ImageDefinition(options),
    view: {
      components: {
        [TYPE]: {
          component: ({ children }: TBComponentProps) => <figure className='tb-image'>{children}</figure>
        },
        [`${TYPE}/content`]: {
          component: (props: TBComponentProps) => <ImageContent {...props} labels={labels} />
        },
        [`${TYPE}/alt`]: {
          component: ({ children, element }: TBComponentProps) => (
            <div className='tb-field tb-image-alt'>
              <FieldContent element={element} label={labels.alt} hint={labels.altHint}>{children}</FieldContent>
            </div>
          )
        },
        [`${TYPE}/caption`]: {
          // A figcaption must sit directly in its figure, without a wrapping <div>
          asOwnElement: true,
          component: ({ children, element, attributes }: TBOwnElementComponentProps<HTMLElement>) => (
            <figcaption {...attributes} className='tb-field tb-image-caption'>
              <FieldContent element={element} label={labels.caption} hint={labels.captionHint}>{children}</FieldContent>
            </figcaption>
          )
        }
      },
      tools: { insert: () => <ImageIcon /> }
    }
  }
}


function ImageContent({ element, children, labels }: TBComponentProps & { labels: ImageLabels }) {
  const editor = useSlateStatic()
  const path = ReactEditor.findPath(editor, element)
  const figure = Node.get(editor, path.slice(0, -1))
  const properties = Element.isElement(figure) ? figure.properties ?? {} : {}
  const src = safeMediaSrc(properties.src)
  // Follows the alt field as it is typed in, which renders separately
  const alt = useSlateSelector((e) => altText(e, element))

  // A void element must render its children: the hidden spacer Slate puts the
  // caret on. Without it, selecting the image leaves no caret in the page, and
  // arrow keys and typing act wherever the browser's caret last was.
  return (
    <>
      <div className='tb-image-content' contentEditable={false} draggable='true'>
        {src
          ? (
            <img
              src={src}
              alt={alt}
              width={typeof properties.width === 'number' ? properties.width : undefined}
              height={typeof properties.height === 'number' ? properties.height : undefined}
              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
            />
          )
          : <div className='tb-image-missing' role='img' aria-label={labels.missing}>{labels.missing}</div>}
      </div>
      {children}
    </>
  )
}

/** The text of the alt field beside the given image content */
function altText(editor: Editor, content: Element): string {
  try {
    const figure = Node.parent(editor, ReactEditor.findPath(editor, content))
    const field = figure.children.find((c) => Element.isElement(c) && c.type === `${TYPE}/alt`)
    return field ? Node.string(field) : ''
  } catch {
    // The image was just removed
    return ''
  }
}
