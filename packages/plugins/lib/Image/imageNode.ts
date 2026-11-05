import type { Element } from 'slate'

export type ImageUpload = {
  src: string
  width?: number
  height?: number
  /** Alternative text, if the host already has one */
  alt?: string
}

/** A complete image block, e.g. to insert an image the host already stores */
export function imageNode({ src, width, height, alt }: ImageUpload, caption = ''): Element {
  return {
    id: crypto.randomUUID(),
    class: 'block',
    type: 'core/image',
    properties: { src, ...(width ? { width } : {}), ...(height ? { height } : {}) },
    children: [
      { id: crypto.randomUUID(), class: 'void', type: 'core/image/content', children: [{ text: '' }] },
      { id: crypto.randomUUID(), class: 'text', type: 'core/image/alt', children: [{ text: alt ?? '' }] },
      { id: crypto.randomUUID(), class: 'text', type: 'core/image/caption', children: [{ text: caption }] }
    ]
  }
}
