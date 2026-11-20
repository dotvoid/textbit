import { useState } from 'react'
import type { TBComponentProps, TBPlugin, TBToolComponentProps } from '@dotvoid/textbit'
import { TextbitElement } from '@dotvoid/textbit'
import { Transforms } from 'slate'
import { ReactEditor, useSlateStatic } from 'slate-react'
import { LinkIcon, LinkOffIcon } from '../shared/icons'
import { isValidLink, sanitizeLink } from './isValidLink'
import { Link as LinkDefinition, TYPE, inputId, linkLabels, removeLink, type LinkLabels, type LinkOptions } from './definition'

export type { LinkOptions, LinkLabels } from './definition'

/**
 * Links. Ctrl/⌘+K links the selection and opens the address field; Ctrl/⌘-click
 * opens a link. Addresses are checked wherever a link is rendered, not only when
 * typed: a `javascript:` address arriving through paste, a collaborator or stored
 * data never becomes a live link.
 */
export const Link = (options: LinkOptions = {}): TBPlugin => {
  const labels = linkLabels(options)

  return {
    ...LinkDefinition(options),
    view: {
      components: { [TYPE]: { component: LinkComponent } },
      tools: {
        edit: [
          () => <LinkIcon />,
          // One field per link: moving from one link to another starts afresh
          (props: TBToolComponentProps) => (
            <EditLink key={linkKey(props.entry)} {...props} labels={labels} />
          )
        ]
      }
    }
  }
}

function linkKey(entry: TBToolComponentProps['entry']): string {
  const [node, path] = entry ?? []
  return TextbitElement.isElement(node) && node.id ? node.id : (path ?? []).join('.')
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
