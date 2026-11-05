import type { TBComponentProps, TBOwnElementComponentProps, TBPluginDefinition } from '@dotvoid/textbit'
import { Element, Node } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { AudioQuoteIcon } from '../shared/icons'
import { ChildPlaceholder } from '../shared/ChildPlaceholder'
import { pickFiles, safeMediaSrc, uploadConsumer } from '../shared/media'
import { audioNode, type AudioUpload } from './audioNode'

const TYPE = 'base/audio'

export type AudioLabels = {
  /** The insert action's name in menus and for screen readers */
  title: string
  caption: string
  missing: string
}

export type AudioOptions = {
  /** Store a dropped or picked file and return where it now lives; see Image */
  upload?: (file: File) => Promise<AudioUpload | undefined>
  /** MIME types to accept. Default: MP3, MP4/AAC, Ogg, WAV and WebM audio. */
  accept?: string[]
  maxSize?: number
  labels?: Partial<AudioLabels>
}

const ACCEPT = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm']
const LABELS: AudioLabels = { title: 'Audio', caption: 'Caption', missing: 'Audio not available' }

/** An audio player with a caption. A reference for building your own, like Image. */
export const Audio = (options: AudioOptions = {}): TBPluginDefinition => {
  const labels = { ...LABELS, ...options.labels }
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
      tool: () => <AudioQuoteIcon />,
      visibility: () => [!!consumer, !!consumer, false],
      handler: (args) => pickFiles(args, accept.join(','))
    }],
    componentEntry: {
      class: 'block',
      component: ({ children }: TBComponentProps) => <figure className='tb-audio'>{children}</figure>,
      children: [
        {
          type: 'content',
          class: 'void',
          component: (props: TBComponentProps) => <AudioContent {...props} labels={labels} />,
          constraints: { min: 1, max: 1 }
        },
        {
          type: 'caption',
          class: 'text',
          // A figcaption must sit directly in its figure, without a wrapping <div>
          asOwnElement: true,
          component: ({ children, element, attributes }: TBOwnElementComponentProps<HTMLElement>) => (
            <figcaption {...attributes} className='tb-audio-caption' style={{ position: 'relative' }}>
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
