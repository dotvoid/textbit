import type { TBPluginDefinition } from '@dotvoid/textbit/headless'
import { pickFiles, uploadConsumer } from '../shared/media'
import { imageNode, type ImageUpload } from './imageNode'

export const TYPE = 'base/image'

/** The image's texts, e.g. translations */
export type ImageLabels = {
  /** The insert action's name in menus and for screen readers */
  title: string
  /** Label before the caption field */
  caption: string
  /** Hint in the empty caption field */
  captionHint: string
  /** Label before the alternative text field */
  alt: string
  /** Hint in the empty alternative text field */
  altHint: string
  /** Shown instead of the image when it has no usable address. Default: 'Image not available'. */
  missing: string
}

/** Options of `Image` */
export type ImageOptions = {
  /**
   * Store a dropped or picked file and return where it now lives. Return
   * undefined to drop the file, e.g. when the user cancels. Without it the
   * plugin only renders images; it cannot add them.
   */
  upload?: (file: File) => Promise<ImageUpload | undefined>
  /** MIME types to accept. Default: JPEG, PNG, GIF, WebP and AVIF. */
  accept?: string[]
  /** Largest file to accept, in bytes. Default: no limit. */
  maxSize?: number
  /** Labels and hints, e.g. translations */
  labels?: Partial<ImageLabels>
}

const ACCEPT = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']
const LABELS: ImageLabels = {
  title: 'Image',
  caption: 'Caption',
  captionHint: 'Add a caption',
  alt: 'Alt text',
  altHint: 'Describe the image for those who cannot see it',
  missing: 'Image not available'
}

/** The labels, the defaults filled in */
export function labelsOf(options: ImageOptions): ImageLabels {
  return { ...LABELS, ...options.labels }
}

/**
 * An image with a caption and alternative text. Files reach it by drop or from
 * the insert action, and are stored by your `upload` function. Also a reference
 * for building your own, which gets a namespace of your own (`acme/image`, not
 * `base/image`).
 */
export const Image = (options: ImageOptions = {}): TBPluginDefinition => {
  const labels = labelsOf(options)
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
      // Only offered when there is somewhere to store the file
      visibility: () => [!!consumer, !!consumer, false],
      handler: (args) => pickFiles(args, accept.join(','))
    }],
    element: {
      class: 'block',
      schema: {
        description: 'An image with alternative text and a caption',
        properties: {
          src: { type: 'string', required: true, description: 'Where the image is, as stored by the host' },
          width: { type: 'number', description: 'Width in pixels' },
          height: { type: 'number', description: 'Height in pixels' }
        }
      },
      children: [
        { type: 'content', class: 'void', schema: { description: 'The image itself' }, constraints: { min: 1, max: 1 } },
        // A text field, not an <input>: the caret moves in and out of it like
        // any other text. It sits before the caption, which must be the
        // figure's first or last child.
        {
          type: 'alt',
          class: 'text',
          schema: { description: 'What the image shows, for those who cannot see it', marks: 'none', inlines: 'none' },
          constraints: { allowBreak: false, min: 1, max: 1 }
        },
        {
          type: 'caption',
          class: 'text',
          schema: { description: 'The caption shown under the image' },
          constraints: { allowBreak: false, min: 1, max: 1 }
        }
      ]
    }
  }
}
