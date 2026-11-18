import type { TBPluginDefinition, TBActionHandlerArgs } from '@dotvoid/textbit/headless'
import { TextbitElement } from '@dotvoid/textbit/headless'
import { Editor, Element, Range, Transforms } from 'slate'
import { hotkeyOption } from '../shared/hotkey'

export const TYPE = 'base/link'

export type LinkLabels = {
  /** The action's name in menus and for screen readers */
  title: string
  /** Name of the address field */
  address: string
  /** Placeholder of the address field */
  placeholder: string
  remove: string
  open: string
}

export type LinkOptions = {
  /** Replace the default shortcut, Ctrl+K / ⌘K, or remove it with `false` */
  hotkey?: string | false
  /** Labels and names, e.g. translations */
  labels?: Partial<LinkLabels>
}

const LABELS: LinkLabels = {
  title: 'Link',
  address: 'Link address',
  placeholder: 'https://',
  remove: 'Remove link',
  open: 'Open link in a new tab'
}

/** The labels, the defaults filled in */
export function linkLabels(options: LinkOptions): LinkLabels {
  return { ...LABELS, ...options.labels }
}

/**
 * Links. Ctrl/⌘+K links the selection and opens the address field; Ctrl/⌘-click
 * opens a link. Addresses are checked wherever a link is rendered, not only when
 * typed: a `javascript:` address arriving through paste, a collaborator or stored
 * data never becomes a live link.
 */
export const Link = (options: LinkOptions = {}): TBPluginDefinition => ({
  class: 'inline',
  name: TYPE,
  element: {
    class: 'inline',
    schema: {
      description: 'A link around text',
      properties: {
        href: { type: 'string', required: true, description: 'The address: http, https, mailto or tel' }
      }
    }
  },
  actions: [{
    name: 'edit',
    title: linkLabels(options).title,
    hotkey: hotkeyOption(options.hotkey, 'mod+k'),
    handler: editLink,
    visibility: (element) => [true, true, element.type === TYPE]
  }]
})

/** On a link: move to its address field. On a selection: make it a link and move there. */
function editLink({ editor, type, event }: TBActionHandlerArgs): void {
  const { selection } = editor
  if (!selection) {
    return
  }

  const [existing] = Editor.nodes(editor, {
    at: Editor.unhangRange(editor, selection),
    match: (n) => !Editor.isEditor(n) && TextbitElement.isInline(n) && n.type === type
  })
  if (existing) {
    const [link] = existing
    if (Element.isElement(link) && typeof link.id === 'string') {
      event?.preventDefault()
      document.getElementById(inputId(link.id))?.focus()
    }
    return
  }

  if (Range.isCollapsed(selection)) {
    return
  }

  event?.preventDefault()
  const id = crypto.randomUUID()
  Editor.withoutNormalizing(editor, () => {
    Transforms.wrapNodes(editor, {
      class: 'inline',
      type,
      id,
      properties: { href: '' },
      children: [{ text: '' }]
    }, { split: true })
  })

  // The address field renders with the toolbar after this change
  setTimeout(() => document.getElementById(inputId(id))?.focus(), 0)
}

export function removeLink(editor: Editor): void {
  Transforms.unwrapNodes(editor, {
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === TYPE
  })
}

/** The id of a link's address field */
export function inputId(linkId: string): string {
  return `tb-link-${linkId}`
}
