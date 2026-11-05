import type { TBComponentProps, TBPluginDefinition } from '@dotvoid/textbit'
import { Element, Node, Transforms } from 'slate'
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react'
import { ImageIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { pickFiles, safeMediaSrc, uploadConsumer } from '../shared/media'
import { imageNode, type ImageUpload } from './imageNode'

const TYPE = 'core/image'

export type ImageLabels = {
  /** The insert action's name in menus and for screen readers */
  title: string
  caption: string
  alt: string
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
  alt: 'Alternative text',
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
          type: 'caption',
          class: 'text',
          component: ({ children, element }: TBComponentProps) => (
            <figcaption className='tb-image-caption' style={{ position: 'relative' }}>
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


function ImageContent({ element, labels }: TBComponentProps & { labels: ImageLabels }) {
  const editor = useSlateStatic()
  const readOnly = useReadOnly()
  const path = ReactEditor.findPath(editor, element)
  const figure = Node.get(editor, path.slice(0, -1))
  const properties = Element.isElement(figure) ? figure.properties ?? {} : {}
  const src = safeMediaSrc(properties.src)
  const alt = typeof properties.alt === 'string' ? properties.alt : ''

  return (
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
      {!readOnly && (
        <input
          className='tb-image-alt'
          type='text'
          aria-label={labels.alt}
          placeholder={labels.alt}
          defaultValue={alt}
          onBlur={(event) => {
            if (Element.isElement(figure) && event.target.value !== alt) {
              Transforms.setNodes(editor, { properties: { ...properties, alt: event.target.value } }, { at: path.slice(0, -1) })
            }
          }}
        />
      )}
    </div>
  )
}
