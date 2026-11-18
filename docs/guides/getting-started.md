# Getting started

Textbit is a rich text editor for React, built on Slate. On its own it edits plain
paragraphs, which is enough for a text field. Headings, formatting, lists, links, tables,
images and the rest are plugins, and the look is a stylesheet you can take or leave.

This guide sets up an editor with the ready-made plugins and the default look.

## Install

```bash
npm install @dotvoid/textbit @dotvoid/textbit-plugins @dotvoid/textbit-styles
```

| Package | What it is |
|---|---|
| `@dotvoid/textbit` | The editor. Without plugins it edits plain paragraphs. |
| `@dotvoid/textbit-plugins` | Ready-made plugins: text with headings, formatting marks, lists, links, tables, code, quotes, images and audio |
| `@dotvoid/textbit-styles` | A default look, in plain CSS with custom properties |

The editor's peer dependencies are installed along with it by npm: `react` and `react-dom`
(18 or 19), `slate` and `slate-react` (0.147), `yjs`, `@slate-yjs/core` and
`@slate-yjs/react`. The Y.js packages are needed even when you do not collaborate: the
editor is built to collaborate, and loads them either way.

## A first editor

```tsx
import { useMemo, useState } from 'react'
import type { Descendant } from 'slate'
import { Textbit } from '@dotvoid/textbit'
import { Text, Bold, Italic, Link, UnorderedList, OrderedList } from '@dotvoid/textbit-plugins'
import '@dotvoid/textbit-styles'

const initialValue: Descendant[] = [
  {
    id: crypto.randomUUID(),
    type: 'base/text',
    class: 'text',
    properties: { role: 'heading-1' },
    children: [{ text: 'A harbour town in winter' }]
  },
  {
    id: crypto.randomUUID(),
    type: 'base/text',
    class: 'text',
    children: [
      { text: 'The boats stay in the harbour and the town grows ' },
      { text: 'quiet', 'base/italic': true },
      { text: '.' }
    ]
  }
]

export function ArticleEditor() {
  const [value, setValue] = useState(initialValue)

  // Create the plugins once, not on every render
  const plugins = useMemo(() => [Text(), Bold(), Italic(), Link(), UnorderedList(), OrderedList()], [])

  return (
    <Textbit.Root value={value} onChange={setValue} plugins={plugins}>
      <Textbit.Editable aria-label='Article' />
    </Textbit.Root>
  )
}
```

A few things to know:

- **`Textbit.Root`** holds the document and the plugins. **`Textbit.Editable`** is where
  people type. Everything else the editor offers, such as menus and the toolbar, goes inside
  the root.
- **`onChange`** is called with the whole document after people stop typing for a moment,
  250 milliseconds by default (`debounce`). It is not called in a read-only editor.
- **`aria-label`** names the editor for screen readers. Without it they announce an unnamed
  text box.
- **The plugins** decide what a document can hold. A document can still contain elements no
  registered plugin knows; they are kept as they are and shown as objects. See
  [The editor](./the-editor.md#objects-whose-plugin-is-missing).

## A plain text field

Without plugins, and with a string as its value, the editor is a multi-line text field. The
value is the text, paragraphs separated by line breaks:

```tsx
function NoteField() {
  const [note, setNote] = useState('')

  return (
    <Textbit.Root value={note} onChange={setNote}>
      <Textbit.Editable aria-label='Note' />
    </Textbit.Root>
  )
}
```

## Formatting from a toolbar

The toolbar appears beside the selection. Fill it with the plugins' actions from the
registry, here the marks (plugins of class `leaf`) and links:

```tsx
import { Textbit, Toolbar, usePluginRegistry } from '@dotvoid/textbit'

function SelectionToolbar() {
  const { actions } = usePluginRegistry()

  return (
    <Toolbar.Root>
      <Toolbar.Group>
        {actions.filter((action) => action.plugin.class === 'leaf').map((action) => (
          <Toolbar.Item key={action.name} action={action} />
        ))}
      </Toolbar.Group>
      <Toolbar.Group>
        {actions.filter((action) => action.plugin.class === 'inline').map((action) => (
          <Toolbar.Item key={action.name} action={action} />
        ))}
      </Toolbar.Group>
    </Toolbar.Root>
  )
}

// Inside Textbit.Root:
<Textbit.Editable aria-label='Article'>
  <SelectionToolbar />
</Textbit.Editable>
```

Each button shows the action's tool, its icon, and is named by the action's title. The
keyboard reaches the toolbar with Alt+F10 (⌥F10 on macOS); see
[Accessibility](./accessibility.md).

## Next

- [Concepts](./concepts.md): what a document is made of.
- [The editor](./the-editor.md): menus, the gutter, the context menu, spelling, read-only, the
  keyboard.
- [Plugins](./plugins.md): the ready-made plugins and their options, and writing your own.
- [Styling](./styling.md): the default look, and styling textbit yourself.
- [Collaboration](./collaboration.md): editing together over Y.js.
- [Agents](./agents.md): AI agents reading and editing the document with people.

Every component, hook, type and function is in the API reference.
