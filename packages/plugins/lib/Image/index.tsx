import type { TBComponentProps, TBOwnElementComponentProps, TBPluginDefinition } from '@dotvoid/textbit'
import { Editor, Element, Node, Transforms } from 'slate'
import { ReactEditor, useSlateSelector, useSlateStatic } from 'slate-react'
import { ImageIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { pickFiles, safeMediaSrc, uploadConsumer } from '../shared/media'
import { imageNode, type ImageUpload } from './imageNode'

const TYPE = 'base/image'

export type ImageLabels = {
  /** The insert action's name in menus and for screen readers */
  title: string
  caption: string
  /** Label before the alternative text field */
  alt: string
  /** Hint in the empty alternative text field */
  altHint: string
  missing: string
}

export type ImageOptions = {
  /**
   * Store a dropped or picked file and return where it now lives. Return
   * undefined to drop the file, e.g. when the user cancels. Without it the
   * plugin only renders images; it cannot add them.
   */
  upload?: (file: File) => Promise<ImageUpload | undefined>
  /** MIME types to accept. Default: JPEG, PNG, GIF, WebP and AVIF. */
  accept?: string[]
  /** Largest file to accept, in bytes */
  maxSize?: number
  /** Labels and hints, e.g. translations */
  labels?: Partial<ImageLabels>
}

const ACCEPT = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
const LABELS: ImageLabels = {
  title: 'Image',
  caption: 'Caption',
  alt: 'Alt text',
  altHint: 'Describe the image for those who cannot see it',
  missing: 'Image not available'
}

/**
 * An image with a caption and alternative text. A reference for building your
 * own: files reach it by drop or from the insert action, and are stored by your
 * `upload` function.
 */
export const Image = (options: ImageOptions = {}): TBPluginDefinition => {
  const labels = { ...LABELS, ...options.labels }
  const accept = options.accept ?? ACCEPT
  const consumer = uploadConsumer<ImageUpload>({
    type: TYPE,
    accept: (mime) => accept.includes(mime),
    maxSize: options.maxSize,
    upload: options.upload,
    build: (uploaded) => imageNode(uploaded)
  })

  return {
    class: 'block',
    name: TYPE,
    ...(consumer ? { consumer } : {}),
    actions: [{
      name: 'insert',
      title: labels.title,
      tool: () => <ImageIcon />,
      // Only offered when there is somewhere to store the file
      visibility: () => [!!consumer, !!consumer, false],
      handler: (args) => pickFiles(args, accept.join(','))
    }],
    componentEntry: {
      class: 'block',
      component: ({ children }: TBComponentProps) => <figure className='tb-image'>{children}</figure>,
      children: [
        {
          type: 'content',
          class: 'void',
          component: (props: TBComponentProps) => <ImageContent {...props} labels={labels} />,
          constraints: { min: 1, max: 1 }
        },
        {
          // A text field, not an <input>: the caret moves in and out of it like
          // any other text. It sits before the caption, which must be the
          // figure's first or last child.
          type: 'alt',
          class: 'text',
          component: (props: TBComponentProps) => <ImageAlt {...props} labels={labels} />,
          constraints: { allowBreak: false, min: 1, max: 1 }
        },
        {
          type: 'caption',
          class: 'text',
          // A figcaption must sit directly in its figure, without a wrapping <div>
          asOwnElement: true,
          component: ({ children, element, attributes }: TBOwnElementComponentProps<HTMLElement>) => (
            <figcaption {...attributes} className='tb-image-caption' style={{ position: 'relative' }}>
              <ChildPlaceholder element={element}>{labels.caption}</ChildPlaceholder>
              {children}
            </figcaption>
          ),
          constraints: { allowBreak: false, min: 1, max: 1 }
        }
      ]
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

function ImageAlt({ element, children, labels }: TBComponentProps & { labels: ImageLabels }) {
  const editor = useSlateStatic()

  return (
    <div className='tb-image-alt'>
      <span
        contentEditable={false}
        className='tb-image-alt-label'
        style={{ userSelect: 'none' }}
        // Like a <label>: a click puts the caret in the field
        onMouseDown={(event) => {
          event.preventDefault()
          Transforms.select(editor, Editor.end(editor, ReactEditor.findPath(editor, element)))
          ReactEditor.focus(editor)
        }}
      >
        {labels.alt}
      </span>
      <span className='tb-image-alt-text' style={{ position: 'relative' }}>
        <ChildPlaceholder element={element}>{labels.altHint}</ChildPlaceholder>
        {children}
      </span>
    </div>
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
