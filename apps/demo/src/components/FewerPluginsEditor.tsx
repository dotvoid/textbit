import { useMemo } from 'react'
import type { Descendant } from 'slate'
import { Textbit } from '@dotvoid/textbit'
import { Bold, Code, Italic, Link, OrderedList, Text, UnorderedList } from '@dotvoid/textbit-plugins'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'

const id = () => crypto.randomUUID()
const text = (t: string) => ({ id: id(), type: 'base/text', class: 'text', properties: {}, children: [{ text: t }] })

const content = [
  text('Copy into this editor from the article: an image, a table or a quote turns into its text here, because this editor has no plugins for them. Copy part of a caption and only that text comes along.'),
  text('No editor on this page has a plugin for the factbox below. Copy it into the article and it stays a factbox there too, or turn it into text or remove it with its buttons.'),
  {
    id: id(), type: 'acme/factbox', class: 'block', properties: { kind: 'info' }, children: [
      { id: id(), type: 'acme/factbox/title', class: 'text', children: [{ text: 'Did you know?' }] },
      { id: id(), type: 'acme/factbox/body', class: 'text', children: [{ text: 'The harbour freezes over about one winter in ten.' }] }
    ]
  },
  text('')
] as Descendant[]

/** An editor with text, formatting, lists and links only, for copying between editors */
export const FewerPluginsEditor = () => {
  const plugins = useMemo(() => [
    Text({ headings: [1, 2] }), Bold(), Italic(), Code(), Link(),
    UnorderedList({ placeholder: 'List item' }), OrderedList({ placeholder: 'List item' })
  ], [])

  return (
    <Textbit.Root value={content} onChange={() => {}} plugins={plugins} placeholders='multiple'>
      <div className='demo-editor'>
        <Textbit.Gutter>
          <GutterMenu />
        </Textbit.Gutter>
        <Textbit.Editable contextMenu='always' aria-label='Editor with fewer plugins'>
          <SelectionToolbar />
          <EditorContextMenu />
        </Textbit.Editable>
      </div>
    </Textbit.Root>
  )
}
