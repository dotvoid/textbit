import type { TBPluginDefinition, TBLeafStyle } from '@dotvoid/textbit/headless'
import { hotkeyOption } from '../shared/hotkey'

/** Options of the marks: Bold, Italic, Underline, Strikethrough and Code */
export type LeafOptions = {
  /** Replace the default shortcut, or remove it with `false` */
  hotkey?: string | false
  /** The action's name in menus and for screen readers, e.g. a translation */
  title?: string
}

// Bold, italic, underline and strikethrough style themselves inline, so they
// read right without any stylesheet. Code needs a font and a background, which
// belong in a stylesheet: it renders with the class tb-code.

/** Bold text, `base/bold`. Shortcut: Ctrl+B / ⌘B. The definition only, without its tool. */
export const Bold = (options?: LeafOptions) =>
  leaf('Bold text', 'base/bold', 'toggle-bold', options?.title ?? 'Bold', hotkeyOption(options?.hotkey, 'mod+b'), { fontWeight: 'bold' })

/** Italic text, `base/italic`. Shortcut: Ctrl+I / ⌘I. The definition only, without its tool. */
export const Italic = (options?: LeafOptions) =>
  leaf('Italic text', 'base/italic', 'toggle-italic', options?.title ?? 'Italic', hotkeyOption(options?.hotkey, 'mod+i'), { fontStyle: 'italic' })

/** Underlined text, `base/underline`. Shortcut: Ctrl+U / ⌘U. The definition only, without its tool. */
export const Underline = (options?: LeafOptions) =>
  leaf('Underlined text', 'base/underline', 'toggle-underline', options?.title ?? 'Underline', hotkeyOption(options?.hotkey, 'mod+u'), { textDecoration: 'underline' })

/** Struck through text, `base/strikethrough`. No shortcut by default. The definition only, without its tool. */
export const Strikethrough = (options?: LeafOptions) =>
  leaf('Struck through text', 'base/strikethrough', 'toggle-strikethrough', options?.title ?? 'Strikethrough', hotkeyOption(options?.hotkey), { textDecoration: 'line-through' })

/** Code within a line, `base/code`, with the class `tb-code`. No shortcut by default. The definition only, without its tool. */
export const Code = (options?: LeafOptions) =>
  leaf('Code within a line of text', 'base/code', 'toggle-code', options?.title ?? 'Code', hotkeyOption(options?.hotkey), 'tb-code')

function leaf(description: string, name: string, action: string, title: string, hotkey: string | undefined, style: TBLeafStyle | string): TBPluginDefinition {
  return {
    class: 'leaf',
    name,
    description,
    actions: [{ name: action, title, hotkey, handler: () => true }],
    getStyle: () => style
  }
}
