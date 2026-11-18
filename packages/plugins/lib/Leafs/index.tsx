import type { TBPlugin, TBToolComponent } from '@dotvoid/textbit'
import { BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon, CodeIcon } from '../shared/icons'
import * as definitions from './definition'
import type { LeafOptions } from './definition'

export type { LeafOptions } from './definition'

export const Bold = (options?: LeafOptions) => withTool(definitions.Bold(options), 'toggle-bold', () => <BoldIcon />)
export const Italic = (options?: LeafOptions) => withTool(definitions.Italic(options), 'toggle-italic', () => <ItalicIcon />)
export const Underline = (options?: LeafOptions) => withTool(definitions.Underline(options), 'toggle-underline', () => <UnderlineIcon />)
export const Strikethrough = (options?: LeafOptions) => withTool(definitions.Strikethrough(options), 'toggle-strikethrough', () => <StrikethroughIcon />)
export const Code = (options?: LeafOptions) => withTool(definitions.Code(options), 'toggle-code', () => <CodeIcon />)

function withTool(definition: TBPlugin, action: string, tool: TBToolComponent): TBPlugin {
  return { ...definition, view: { tools: { [action]: tool } } }
}
