import type { LeafStyle, Plugin } from '../lib/types'

// Core has no formatting of its own; tests that need marks register these
const leaf = (name: string, title: string, hotkey: string, style: LeafStyle): Plugin => ({
  class: 'leaf',
  name: `base/${name}`,
  actions: [{ name: `toggle-${name}`, title, hotkey, handler: () => true }],
  getStyle: () => style,
  view: {
    tools: { [`toggle-${name}`]: () => <span>{title[0]}</span> }
  }
})

export const Bold = () => leaf('bold', 'Bold', 'mod+b', { fontWeight: 'bold' })
export const Italic = () => leaf('italic', 'Italic', 'mod+i', { fontStyle: 'italic' })
export const Underline = () => leaf('underline', 'Underline', 'mod+u', { textDecoration: 'underline' })
