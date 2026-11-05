import { useState } from 'react'
import type { TBComponentProps, TBPluginDefinition, TBActionHandlerArgs, TBToolComponentProps } from '@dotvoid/textbit'
import { TextbitElement } from '@dotvoid/textbit'
import { Editor, Element, Range, Transforms } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { LinkIcon, LinkOffIcon } from '../shared/icons'
import { hotkeyOption } from '../shared/hotkey'
import { isValidLink, sanitizeLink } from './isValidLink'

const TYPE = 'core/link'

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

/**
 * Links. Ctrl/⌘+K links the selection and opens the address field; Ctrl/⌘-click
 * opens a link. Addresses are checked wherever a link is rendered, not only when
 * typed: a `javascript:` address arriving through paste, a collaborator or stored
 * data never becomes a live link.
 */
export const Link = (options: LinkOptions = {}): TBPluginDefinition => {
  const labels = { ...LABELS, ...options.labels }

  return {
    class: 'inline',
    name: TYPE,
    componentEntry: {
      class: 'inline',
      component: LinkComponent
    },
    actions: [{
      name: 'edit',
      title: labels.title,
      tool: [
        () => <LinkIcon />,
        (props: TBToolComponentProps) => <EditLink {...props} labels={labels} />
      ],
      hotkey: hotkeyOption(options.hotkey, 'mod+k'),
      handler: editLink,
      visibility: (element) => [true, true, element.type === TYPE]
    }]
  }
}

function LinkComponent({ children, element }: TBComponentProps) {
  const href = sanitizeLink(typeof element.properties?.href === 'string' ? element.properties.href : '')
  const valid = isValidLink(href)

  return (
    <a
      href={valid ? href : undefined}
      className='tb-link'
      {...(!valid ? { 'data-invalid': '' } : {})}
      onClick={(event) => {
        if (valid && (event.ctrlKey || event.metaKey)) {
          event.preventDefault()
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      }}
    >
      {children}
    </a>
  )
}

function EditLink({ entry, labels }: TBToolComponentProps & { labels: LinkLabels }) {
  const editor = useSlateStatic()
  const [node, path] = entry || []
  const initial = TextbitElement.isElement(node) && typeof node.properties?.href === 'string' ? node.properties.href : ''
  const [href, setHref] = useState(initial)
  const [touched, setTouched] = useState(false)

  if (!TextbitElement.isElement(node) || !path) {
    return null
  }

  const save = () => {
    const clean = sanitizeLink(href)
    if (clean === '') {
      removeLink(editor)
    } else {
      Transforms.setNodes(editor, { properties: { ...node.properties, href: clean } }, { at: path })
    }
  }

  return (
    <div className='tb-link-editor' role='group' aria-label={labels.title}>
      <button
        type='button'
        className='tb-link-remove'
        aria-label={labels.remove}
        title={labels.remove}
        onMouseDown={(event) => {
          event.preventDefault()
          removeLink(editor)
        }}
      >
        <LinkOffIcon />
      </button>
      <input
        id={node.id ? inputId(node.id) : undefined}
        className='tb-link-address'
        type='url'
        value={href}
        aria-label={labels.address}
        placeholder={labels.placeholder}
        autoComplete='off'
        onFocus={() => setTouched(true)}
        onMouseDownCapture={(event) => {
          event.stopPropagation()
          event.preventDefault()
          event.currentTarget.focus()
        }}
        onChange={(event) => setHref(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            ReactEditor.focus(editor)
          }
        }}
        onBlur={() => {
          if (touched) {
            save()
          }
        }}
      />
      {isValidLink(href, true) && (
        <a
          className='tb-link-open'
          href={sanitizeLink(href)}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={labels.open}
          title={labels.open}
        >
          <LinkIcon />
        </a>
      )}
    </div>
  )
}

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

function removeLink(editor: Editor): void {
  Transforms.unwrapNodes(editor, {
    match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === TYPE
  })
}

function inputId(linkId: string): string {
  return `tb-link-${linkId}`
}
