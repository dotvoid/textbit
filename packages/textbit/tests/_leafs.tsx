import type { CSSProperties } from 'react'
import type { PluginDefinition } from '../lib/types'

// Core has no formatting of its own; tests that need marks register these
const leaf = (name: string, title: string, hotkey: string, style: CSSProperties): PluginDefinition => ({
  class: 'leaf',
  name: `core/${name}`,
  actions: [{ name: `toggle-${name}`, title, hotkey, tool: () => <span>{title[0]}</span>, handler: () => true }],
  getStyle: () => style
})

export const Bold = () => leaf('bold', 'Bold', 'mod+b', { fontWeight: 'bold' })
export const Italic = () => leaf('italic', 'Italic', 'mod+i', { fontStyle: 'italic' })
export const Underline = () => leaf('underline', 'Underline', 'mod+u', { textDecoration: 'underline' })
