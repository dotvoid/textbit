import type { Element } from 'slate'

/** Where audio now lives, as `upload` returns it or `audioNode` takes it */
export type AudioUpload = {
  /** Its address: an `http(s):` or relative URL, a `blob:` URL, or a `data:audio/…` one */
  src: string
  /** Its title, given to screen readers as the player's name */
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
