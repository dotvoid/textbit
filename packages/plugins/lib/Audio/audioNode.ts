import type { Element } from 'slate'

export type AudioUpload = {
  src: string
  title?: string
}

/** A complete audio block, e.g. to insert audio the host already stores */
export function audioNode({ src, title }: AudioUpload, caption = ''): Element {
  return {
    id: crypto.randomUUID(),
    class: 'block',
    type: 'base/audio',
    properties: { src, title: title ?? '' },
    children: [
      { id: crypto.randomUUID(), class: 'void', type: 'base/audio/content', children: [{ text: '' }] },
      { id: crypto.randomUUID(), class: 'text', type: 'base/audio/caption', children: [{ text: caption }] }
    ]
  }
}
