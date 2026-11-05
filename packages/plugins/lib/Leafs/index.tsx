import type { TBPluginDefinition } from '@dotvoid/textbit'
import { BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon, CodeIcon } from '../shared/icons'
import { hotkeyOption } from '../shared/hotkey'

export type LeafOptions = {
  /** Replace the default shortcut, or remove it with `false` */
  hotkey?: string | false
  /** The action's name in menus and for screen readers, e.g. a translation */
  title?: string
}

const hotkey = (options: LeafOptions | undefined, fallback?: string) => hotkeyOption(options?.hotkey, fallback)

// Bold, italic, underline and strikethrough style themselves inline, so they
// read right without any stylesheet. Code needs a font and a background, which
// belong in a stylesheet: it renders with the class tb-code.

export const Bold = (options?: LeafOptions): TBPluginDefinition => ({
  class: 'leaf',
  name: 'base/bold',
  actions: [{
    name: 'toggle-bold',
    title: options?.title ?? 'Bold',
    tool: () => <BoldIcon />,
    hotkey: hotkey(options, 'mod+b'),
    handler: () => true
  }],
  getStyle: () => ({ fontWeight: 'bold' })
})

export const Italic = (options?: LeafOptions): TBPluginDefinition => ({
  class: 'leaf',
  name: 'base/italic',
  actions: [{
    name: 'toggle-italic',
    title: options?.title ?? 'Italic',
    tool: () => <ItalicIcon />,
    hotkey: hotkey(options, 'mod+i'),
    handler: () => true
  }],
  getStyle: () => ({ fontStyle: 'italic' })
})

export const Underline = (options?: LeafOptions): TBPluginDefinition => ({
  class: 'leaf',
  name: 'base/underline',
  actions: [{
    name: 'toggle-underline',
    title: options?.title ?? 'Underline',
    tool: () => <UnderlineIcon />,
    hotkey: hotkey(options, 'mod+u'),
    handler: () => true
  }],
  getStyle: () => ({ textDecoration: 'underline' })
})

export const Strikethrough = (options?: LeafOptions): TBPluginDefinition => ({
  class: 'leaf',
  name: 'base/strikethrough',
  actions: [{
    name: 'toggle-strikethrough',
    title: options?.title ?? 'Strikethrough',
    tool: () => <StrikethroughIcon />,
    hotkey: hotkey(options),
    handler: () => true
  }],
  getStyle: () => ({ textDecoration: 'line-through' })
})

export const Code = (options?: LeafOptions): TBPluginDefinition => ({
  class: 'leaf',
  name: 'base/code',
  actions: [{
    name: 'toggle-code',
    title: options?.title ?? 'Code',
    tool: () => <CodeIcon />,
    hotkey: hotkey(options),
    handler: () => true
  }],
  getStyle: () => 'tb-code'
})
