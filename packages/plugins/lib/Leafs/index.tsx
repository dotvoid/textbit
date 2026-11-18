import type { TBPlugin, TBToolComponent } from '@dotvoid/textbit'
import { BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon, CodeIcon } from '../shared/icons'
import * as definitions from './definition'
import type { LeafOptions } from './definition'

export type { LeafOptions } from './definition'

/** Bold text, `base/bold`. Shortcut: Ctrl+B / ⌘B. With its toolbar button. */
export const Bold = (options?: LeafOptions) => withTool(definitions.Bold(options), 'toggle-bold', () => <BoldIcon />)
/** Italic text, `base/italic`. Shortcut: Ctrl+I / ⌘I. With its toolbar button. */
export const Italic = (options?: LeafOptions) => withTool(definitions.Italic(options), 'toggle-italic', () => <ItalicIcon />)
/** Underlined text, `base/underline`. Shortcut: Ctrl+U / ⌘U. With its toolbar button. */
export const Underline = (options?: LeafOptions) => withTool(definitions.Underline(options), 'toggle-underline', () => <UnderlineIcon />)
/** Struck through text, `base/strikethrough`. No shortcut by default. With its toolbar button. */
export const Strikethrough = (options?: LeafOptions) => withTool(definitions.Strikethrough(options), 'toggle-strikethrough', () => <StrikethroughIcon />)
/** Code within a line, `base/code`, with the class `tb-code`. No shortcut by default. With its toolbar button. */
export const Code = (options?: LeafOptions) => withTool(definitions.Code(options), 'toggle-code', () => <CodeIcon />)

function withTool(definition: TBPlugin, action: string, tool: TBToolComponent): TBPlugin {
  return { ...definition, view: { tools: { [action]: tool } } }
}
