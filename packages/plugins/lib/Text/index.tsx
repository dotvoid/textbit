import type { TBPluginDefinition, TBComponentProps } from '@dotvoid/textbit'
import { TextbitEditor, TEXT_TYPE } from '@dotvoid/textbit'
import type { Element } from 'slate'
import {
  ParagraphIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  Heading4Icon
} from '../shared/icons'
import { hotkeyOption } from '../shared/hotkey'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6
export type TextRole = 'paragraph' | `heading-${HeadingLevel}`

export type TextOptions = {
  /** Heading levels to offer. Default: 1 to 4. */
  headings?: HeadingLevel[]
  /** Single line text, like a title field: no Enter, no soft breaks */
  singleLine?: boolean
  /** Action names in menus and for screen readers, e.g. translations */
  titles?: Partial<Record<TextRole, string>>
  /** Hint shown in an empty block, per role */
  placeholders?: Partial<Record<TextRole, string>>
  /** Replace a role's shortcut, or remove it with `false` */
  hotkeys?: Partial<Record<TextRole, string | false>>
}

const ICONS: Partial<Record<TextRole, () => React.ReactNode>> = {
  'paragraph': () => <ParagraphIcon />,
  'heading-1': () => <Heading1Icon />,
  'heading-2': () => <Heading2Icon />,
  'heading-3': () => <Heading3Icon />,
  'heading-4': () => <Heading4Icon />
}

/**
 * Paragraphs and headings. Replaces the editor's built-in `base/text` plugin and
 * keeps its document format: a paragraph has no role, a heading has the role
 * `heading-1` to `heading-6`, and renders as the matching h1 to h6.
 */
export const Text = (options: TextOptions = {}): TBPluginDefinition => {
  const { headings = [1, 2, 3, 4], singleLine = false } = options
  const roles: TextRole[] = ['paragraph', ...headings.map((level) => `heading-${level}` as const)]

  return {
    class: 'text',
    name: TEXT_TYPE,
    componentEntry: {
      class: 'text',
      component: TextComponent,
      placeholder: (element: Element) => options.placeholders?.[roleOf(element)] ?? '',
      constraints: {
        allowBreak: !singleLine,
        allowSoftBreak: !singleLine
      }
    },
    actions: roles.map((role) => ({
      name: role === 'paragraph' ? 'set-paragraph' : `set-${role}`,
      title: options.titles?.[role] ?? defaultTitle(role),
      tool: ICONS[role],
      // Ctrl+Alt+digit as in Google Docs; Cmd+Option+digit on macOS
      hotkey: hotkeyOption(options.hotkeys?.[role], `mod+alt+${role === 'paragraph' ? 0 : role.slice(-1)}`),
      visibility: (element: Element, innerElement?: Element) => {
        const target = innerElement ?? element
        return [target.type === TEXT_TYPE, true, target.type === TEXT_TYPE && roleOf(target) === role]
      },
      handler: ({ editor }) => {
        TextbitEditor.convertToTextNode(editor, TEXT_TYPE, role === 'paragraph' ? undefined : role)
      }
    }))
  }
}

function TextComponent({ element, children }: TBComponentProps) {
  const role = roleOf(element)
  const Tag = role === 'paragraph' ? 'p' : (`h${role.slice(-1)}` as 'h1')
  return <Tag className={`tb-text tb-${role}`}>{children}</Tag>
}

function roleOf(element: Element): TextRole {
  const role = element.properties?.role
  return typeof role === 'string' && /^heading-[1-6]$/.test(role) ? role as TextRole : 'paragraph'
}

function defaultTitle(role: TextRole): string {
  return role === 'paragraph' ? 'Paragraph' : `Heading ${role.slice(-1)}`
}
