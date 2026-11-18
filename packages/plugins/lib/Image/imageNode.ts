import type { Element } from 'slate'

/** Where an image now lives, as `upload` returns it or `imageNode` takes it */
export type ImageUpload = {
  /** Its address: an `http(s):` or relative URL, a `blob:` URL, or a `data:image/…` one */
  src: string
  /** Its width in pixels, if known; keeps the page from jumping as it loads */
  width?: number
  /** Its height in pixels, if known */
  height?: number
  /** Alternative text, if the host already has one */
  alt?: string
}

/** A complete image block, e.g. to insert an image the host already stores */
export function imageNode({ src, width, height, alt }: ImageUpload, caption = ''): Element {
  return {
    id: crypto.randomUUID(),
    class: 'block',
    type: 'base/image',
    properties: { src, ...(width ? { width } : {}), ...(height ? { height } : {}) },
    children: [
      { id: crypto.randomUUID(), class: 'void', type: 'base/image/content', children: [{ text: '' }] },
      { id: crypto.randomUUID(), class: 'text', type: 'base/image/alt', children: [{ text: alt ?? '' }] },
      { id: crypto.randomUUID(), class: 'text', type: 'base/image/caption', children: [{ text: caption }] }
    ]
  }
}
