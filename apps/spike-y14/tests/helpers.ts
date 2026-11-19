import * as Y from '@y/y'
import { createEditor, Element, type Editor } from 'slate'
import type { SlateElement } from '../src/model.ts'

/** A plain Slate editor that knows textbit's inline elements */
export function makeEditor(): Editor {
  const editor = createEditor()
  const { isInline } = editor
  editor.isInline = (element: Element) => (element as SlateElement).class === 'inline' || isInline(element)
  return editor
}

/** Documents exchanging their updates, at once or when told to */
export class Network {
  docs: Y.Doc[] = []
  queue: Array<{ to: Y.Doc, update: Uint8Array }> = []
  live: boolean

  constructor({ live = true } = {}) {
    this.live = live
  }

  add(doc: Y.Doc): Y.Doc {
    for (const other of this.docs) {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), this)
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc), this)
    }
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) {
        return
      }
      for (const other of this.docs) {
        if (other !== doc) {
          this.queue.push({ to: other, update })
        }
      }
      if (this.live) {
        this.flush()
      }
    })
    this.docs.push(doc)
    return doc
  }

  /** Delivers some of the waiting updates, in order per receiver */
  deliver(count: number) {
    const now = this.queue.splice(0, count)
    for (const { to, update } of now) {
      Y.applyUpdate(to, update, this)
    }
  }

  flush() {
    while (this.queue.length) {
      this.deliver(this.queue.length)
    }
  }
}

/** A seeded random number generator, so failures can be replayed */
export function random(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (max: number) => Math.floor(next() * max),
    pick: <T>(items: T[]): T => items[Math.floor(next() * items.length)]
  }
}

let ids = 0
export const newId = () => `b${++ids}`

export const sample: SlateElement[] = [
  {
    id: 'h1',
    type: 'core/text',
    class: 'text',
    properties: { role: 'heading-1' },
    children: [{ text: 'A harbour town' }]
  },
  {
    id: 'p1',
    type: 'core/text',
    class: 'text',
    children: [
      { text: 'Boats ' },
      { text: 'rest', bold: true },
      { text: ' in the ' },
      { id: 'l1', type: 'core/link', class: 'inline', properties: { url: 'https://example.com' }, children: [{ text: 'harbour', italic: true }] },
      { text: ' all winter.' }
    ]
  },
  {
    id: 'ul',
    type: 'core/list',
    class: 'block',
    children: [
      { id: 'li1', type: 'core/list/item', class: 'text', children: [{ text: 'Nets' }] },
      { id: 'li2', type: 'core/list/item', class: 'text', children: [{ text: 'Ropes' }] }
    ]
  } as SlateElement,
  { id: 'img', type: 'core/image', class: 'void', properties: { src: 'a.png' }, children: [{ text: '' }] }
]
