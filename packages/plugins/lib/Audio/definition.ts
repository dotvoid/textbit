import type { TBPluginDefinition } from '@dotvoid/textbit/headless'
import { pickFiles, uploadConsumer } from '../shared/media'
import { audioNode, type AudioUpload } from './audioNode'

export const TYPE = 'base/audio'

/** The audio's texts, e.g. translations */
export type AudioLabels = {
  /** The insert action's name in menus and for screen readers */
  title: string
  /** Label before the caption field */
  caption: string
  /** Hint in the empty caption field */
  captionHint: string
  /** Shown instead of the player when the audio has no usable address. Default: 'Audio not available'. */
  missing: string
}

/** Options of `Audio` */
export type AudioOptions = {
  /** Store a dropped or picked file and return where it now lives; see Image */
  upload?: (file: File) => Promise<AudioUpload | undefined>
  /** MIME types to accept. Default: MP3, MP4/AAC, Ogg, WAV and WebM audio. */
  accept?: string[]
  /** Largest file to accept, in bytes. Default: no limit. */
  maxSize?: number
  /** Labels and hints, e.g. translations */
  labels?: Partial<AudioLabels>
}

const ACCEPT = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm']
const LABELS: AudioLabels = {
  title: 'Audio',
  caption: 'Caption',
  captionHint: 'Add a caption',
  missing: 'Audio not available'
}

/** The labels, the defaults filled in */
export function labelsOf(options: AudioOptions): AudioLabels {
  return { ...LABELS, ...options.labels }
}

/** An audio player with a caption. A reference for your own, like Image, under your own namespace. */
export const Audio = (options: AudioOptions = {}): TBPluginDefinition => {
  const labels = labelsOf(options)
  const accept = options.accept ?? ACCEPT
  const consumer = uploadConsumer<AudioUpload>({
    type: TYPE,
    accept: (mime) => accept.includes(mime),
    maxSize: options.maxSize,
    upload: options.upload,
    build: (uploaded, file) => audioNode({ ...uploaded, title: uploaded.title ?? file.name })
  })

  return {
    class: 'block',
    name: TYPE,
    ...(consumer ? { consumer } : {}),
    actions: [{
      name: 'insert',
      title: labels.title,
      visibility: () => [!!consumer, !!consumer, false],
      handler: (args) => pickFiles(args, accept.join(','))
    }],
    element: {
      class: 'block',
      schema: {
        description: 'An audio player with a caption',
        properties: {
          src: { type: 'string', required: true, description: 'Where the audio is, as stored by the host' },
          title: { type: 'string', description: 'What the recording is called' }
        }
      },
      children: [
        { type: 'content', class: 'void', schema: { description: 'The player' }, constraints: { min: 1, max: 1 } },
        {
          type: 'caption',
          class: 'text',
          schema: { description: 'The caption shown under the player' },
          constraints: { allowBreak: false, min: 1, max: 1 }
        }
      ]
    }
  }
}



