import type { TBPluginDefinition, TBLeafStyle } from '@dotvoid/textbit/headless'
import { hotkeyOption } from '../shared/hotkey'

export type LeafOptions = {
  /** Replace the default shortcut, or remove it with `false` */
  hotkey?: string | false
  /** The action's name in menus and for screen readers, e.g. a translation */
  title?: string
}

// Bold, italic, underline and strikethrough style themselves inline, so they
// read right without any stylesheet. Code needs a font and a background, which
// belong in a stylesheet: it renders with the class tb-code.

export const Bold = (options?: LeafOptions) =>
  leaf('base/bold', 'toggle-bold', options?.title ?? 'Bold', hotkeyOption(options?.hotkey, 'mod+b'), { fontWeight: 'bold' })

export const Italic = (options?: LeafOptions) =>
  leaf('base/italic', 'toggle-italic', options?.title ?? 'Italic', hotkeyOption(options?.hotkey, 'mod+i'), { fontStyle: 'italic' })

export const Underline = (options?: LeafOptions) =>
  leaf('base/underline', 'toggle-underline', options?.title ?? 'Underline', hotkeyOption(options?.hotkey, 'mod+u'), { textDecoration: 'underline' })

export const Strikethrough = (options?: LeafOptions) =>
  leaf('base/strikethrough', 'toggle-strikethrough', options?.title ?? 'Strikethrough', hotkeyOption(options?.hotkey), { textDecoration: 'line-through' })

export const Code = (options?: LeafOptions) =>
  leaf('base/code', 'toggle-code', options?.title ?? 'Code', hotkeyOption(options?.hotkey), 'tb-code')

function leaf(name: string, action: string, title: string, hotkey: string | undefined, style: TBLeafStyle | string): TBPluginDefinition {
  return {
    class: 'leaf',
    name,
    actions: [{ name: action, title, hotkey, handler: () => true }],
    getStyle: () => style
  }
}
