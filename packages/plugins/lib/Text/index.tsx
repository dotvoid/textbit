import type { TBPlugin, TBComponentProps, TBToolComponent } from '@dotvoid/textbit'
import { TEXT_TYPE } from '@dotvoid/textbit'
import {
  ParagraphIcon,
  PreambleIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon
} from '../shared/icons'
import { Text as TextDefinition, roleOf, type TextOptions } from './definition'

export type { TextOptions, TextRole, HeadingLevel } from './definition'

// By action name. A tool for an action the options leave out is not used.
const TOOLS: Record<string, TBToolComponent> = {
  'set-paragraph': () => <ParagraphIcon />,
  'set-preamble': () => <PreambleIcon />,
  'set-heading-1': () => <Heading1Icon />,
  'set-heading-2': () => <Heading2Icon />,
  'set-heading-3': () => <Heading3Icon />,
  'set-heading-4': () => <Heading4Icon />
}

/**
 * Paragraphs, headings and a lead-in. Replaces the editor's built-in `base/text`
 * plugin and keeps its document format: a paragraph has no role, a heading has
 * the role `heading-1` to `heading-6` and renders as the matching h1 to h6, and
 * a lead-in has the role `preamble` and renders as a paragraph.
 */
export const Text = (options: TextOptions = {}): TBPlugin => ({
  ...TextDefinition(options),
  view: {
    components: { [TEXT_TYPE]: { component: TextComponent } },
    tools: TOOLS
  }
})

function TextComponent({ element, children }: TBComponentProps) {
  const role = roleOf(element)
  const Tag = role === 'paragraph' || role === 'preamble' ? 'p' : (`h${role.slice(-1)}` as 'h1')
  return <Tag className={`tb-text tb-${role}`}>{children}</Tag>
}
