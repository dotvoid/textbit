# Plugins

Everything a document can hold beyond plain paragraphs comes from plugins: headings, marks,
lists, links, tables, images, and your own content types. This guide covers the ready-made
plugins first, then writing your own.

## The ready-made plugins

```bash
npm install @dotvoid/textbit-plugins
```

```tsx
import { Textbit } from '@dotvoid/textbit'
import {
  Text, Bold, Italic, Underline, Strikethrough, Code,
  UnorderedList, OrderedList, CodeBlock, Table, Link,
  LocalizedQuotationMarks, Image, Audio, Blockquote
} from '@dotvoid/textbit-plugins'

const plugins = [Text(), Bold(), Italic(), Link(), UnorderedList(), OrderedList()]

<Textbit.Root value={value} onChange={setValue} plugins={plugins}>
  <Textbit.Editable aria-label='Article' />
</Textbit.Root>
```

Every plugin is a named export, and bundlers keep only the ones you import.

| Plugin | Adds | Default shortcut |
|---|---|---|
| `Text` | `base/text`, with the roles `heading-1` to `heading-6` and `preamble` | Ctrl+Alt+0 to 4 (⌘⌥0 to 4) |
| `Bold`, `Italic`, `Underline` | marks `base/bold`, `base/italic`, `base/underline` | Ctrl/⌘+B, I, U |
| `Strikethrough`, `Code` | marks `base/strikethrough`, `base/code` | none |
| `UnorderedList`, `OrderedList` | `base/unordered-list`, `base/ordered-list` | Ctrl/⌘+Shift+8, Ctrl/⌘+Shift+7 |
| `CodeBlock` | `base/code-block` | none |
| `Table` | `base/table` | none |
| `Link` | the inline `base/link` | Ctrl/⌘+K |
| `LocalizedQuotationMarks` | typographic quotes and dashes as you type | none |
| `Image` | `base/image`, with alternative text and a caption | none |
| `Audio` | `base/audio`, with a caption | none |
| `Blockquote` | `base/blockquote`, a quote and its source | none |

### Options

- **`Text({ headings, preamble, singleLine, titles, placeholders, hotkeys })`**: which heading
  levels to offer (default 1 to 4), whether to offer the lead-in (`preamble`), and
  `singleLine` for a title field, with no Enter and no line breaks. A paragraph has no role.
  `Text` replaces core's plain paragraph and keeps its format.
- **Marks** take `{ hotkey, title }`. `Code` renders with the class `tb-code`, for a
  stylesheet to give it a monospace font.
- **Lists** take `{ title, placeholder, hotkey }`. Use both to switch a list between bullets
  and numbers. Enter on an empty last item leaves the list.
- **`CodeBlock({ indentSize, title, placeholder, hotkey })`**: Tab indents inside it.
- **`Table({ rows, columns, titles })`**: Tab and Shift+Tab move between cells, Tab in the last
  cell adds a row. Its row and column actions show in menus while the caret is in a cell.
- **`Link({ hotkey, labels })`**: Ctrl/⌘+K links the selection and moves to the address field;
  Ctrl/⌘-click opens a link. Addresses are checked whenever a link is rendered, so a
  `javascript:` address arriving through a paste, a collaborator or stored data never becomes a
  live link.
- **`Image({ upload, accept, maxSize, labels })`** and **`Audio(...)`**: dropped and picked
  files go to your `upload` function, and what it returns becomes the block. Without `upload`
  the plugin renders media but offers no way to add it: textbit never stores a file in the
  document itself.

  ```tsx
  Image({
    upload: async (file) => {
      const { url, width, height } = await myStorage.put(file)
      return { src: url, width, height }  // or undefined to drop the file
    }
  })
  ```

  Only `http`, `https`, `blob` and image or audio `data` addresses are rendered.
  `imageNode()` and `audioNode()` build a complete block, to insert media you already store.
- **`Blockquote({ labels, hotkey })`**: leave the source empty when there is none.

Every visible and announced text is English by default and can be replaced through the
options, for example `Text({ titles: { 'heading-1': 'Rubrik 1' } })` or
`Link({ labels: { title: 'Länk' } })`. Every plugin takes `hotkey: false` (`hotkeys` for
`Text`) to remove a shortcut.

## Writing a plugin

A plugin has two halves:

- **The definition** says what the plugin is: its name, its element and the element's
  children, their rules, its schema, its actions and what it consumes. It needs neither React
  nor a browser.
- **The view** says what it looks like: the React components that render its elements, and
  the tools, the icons, shown for its actions.

The split is what lets one plugin run everywhere. `Textbit.Root` takes plugins with their
views (`TBPlugin`). A server, a script or an agent uses `createTextbitEditor` with the
definitions alone (`TBPluginDefinition`), and gets the same rules without loading React. See
[Without a user interface](./headless.md).

### The definition

Keep the definition in a file of its own that imports nothing from React, and import from
`@dotvoid/textbit/headless` there:

```ts
// factbox/definition.ts
import type { TBPluginDefinition } from '@dotvoid/textbit/headless'
import { Transforms } from 'slate'

export type FactboxOptions = { title?: string }

export const Factbox = (options: FactboxOptions = {}): TBPluginDefinition => ({
  class: 'block',
  name: 'acme/factbox',
  description: 'A box of facts beside the article',

  // The plugin's element. Its type is the plugin's name.
  element: {
    class: 'block',
    schema: {
      description: 'A box of facts with a heading and a body',
      properties: { tone: { type: 'string', enum: ['neutral', 'warning'] } }
    },
    children: [
      // Full type acme/factbox/heading
      { type: 'heading', class: 'text', placeholder: 'Heading', constraints: { allowBreak: false, min: 1, max: 1 } },
      // Full type acme/factbox/body
      { type: 'body', class: 'text', placeholder: 'Facts', constraints: { min: 1, max: 1 } }
    ]
  },

  actions: [{
    name: 'insert',
    title: options.title ?? 'Factbox',
    handler: ({ editor }) => {
      Transforms.insertNodes(editor, {
        id: crypto.randomUUID(),
        class: 'block',
        type: 'acme/factbox',
        properties: { tone: 'neutral' },
        children: [
          { id: crypto.randomUUID(), class: 'text', type: 'acme/factbox/heading', children: [{ text: '' }] },
          { id: crypto.randomUUID(), class: 'text', type: 'acme/factbox/body', children: [{ text: '' }] }
        ]
      })
    }
  }]
})
```

Type the function's return, as above (`(): TBPluginDefinition =>`), rather than the variable.
TypeScript does not check an object returned from a function whose return type it infers, so
a misspelled field would be ignored without a word.

### The view

```tsx
// factbox/index.tsx
import type { TBComponentProps, TBPlugin } from '@dotvoid/textbit'
import { Factbox as FactboxDefinition, type FactboxOptions } from './definition'

export const Factbox = (options: FactboxOptions = {}): TBPlugin => ({
  ...FactboxDefinition(options),
  view: {
    components: {
      'acme/factbox': { component: Box },
      'acme/factbox/heading': { component: ({ children }) => <h3>{children}</h3> },
      'acme/factbox/body': { component: ({ children }) => <div>{children}</div> }
    },
    tools: {
      insert: () => <span aria-hidden='true'>F</span>  // the button is named by the action's title
    }
  }
})

function Box({ element, children }: TBComponentProps) {
  return <aside className={`factbox factbox-${element.properties?.tone ?? 'neutral'}`}>{children}</aside>
}
```

Components are keyed by full type: the plugin's name for its own element, `name/child` for a
child, `name/child/grandchild` below that. Tools are keyed by action name. An element whose
plugin has no view, or no component for it, renders its children as they are.

A component gets `element`, `children` (render them), `editor`, `options` (the plugin's), and
for a child, `rootNode`, the top-level element it is in.

Textbit wraps each component in a `div` carrying the element's attributes. Where the HTML
element matters, such as a `tr` in a table or an `li` in a list, set `asOwnElement: true` and
spread `attributes` onto your root element; without them selection breaks:

```tsx
'acme/table/row': {
  asOwnElement: true,
  component: ({ children, attributes }: TBOwnElementComponentProps<HTMLTableRowElement>) => <tr {...attributes}>{children}</tr>
}
```

### Element fields

| Field | |
|---|---|
| `class` | `'text'`, `'block'`, `'void'` or `'inline'`. The plugin's own `class` may also be `'leaf'` (a mark) or `'generic'` (no element). |
| `type` | Required on a child; its own part of the full type. On the plugin's element it defaults to the plugin's name. |
| `children` | The element's children, each with its own fields |
| `constraints` | Editing rules, below |
| `placeholder` | Hint in an empty text element: a string, or a function of the element returning one |
| `droppable` | Whether the element takes drops, on a plugin's own element |
| `schema` | What the element means and stores. See [Schema and validation](./schema-and-validation.md). |

### Constraints

| Constraint | Default | |
|---|---|---|
| `allowBreak` | `true` | `false`: Enter does nothing inside it |
| `allowSoftBreak` | | Whether Shift+Enter breaks a line. Opt-in: allowed where the element or one around it sets `true`, and none sets `false`. |
| `allowExitBreak` | `true` | `false`: Enter at the very end does not leave the block for a new paragraph |
| `allowEdgeWhitespace` | `true` | `false`: no space typed at the start, trailing spaces removed on blur |
| `min`, `max` | | On a child: how many of it the parent holds |
| `normalizeNode` | | Your own repair, `(editor, entry) => boolean`; return `true` when it changed something |

`min` and `max` only apply to children; TypeScript rejects them on a plugin's own element. Set
both to 1 for a field that always exists exactly once, such as a caption: removing it puts it
back, and Enter cannot split it. Textbit keeps documents within these rules on every change:
it inserts what is missing, removes what is too many, and puts children in the order of the
`children` array. A block is never removed because of its children. Your `normalizeNode` runs
after that, for rules of your own, such as a table keeping its rows the same width.

### Actions

An action is something the plugin does, from a shortcut, a menu or the toolbar:

| Field | |
|---|---|
| `name` | Unique within the plugin. Its full name is `plugin/name`, as in `<Menu.Item action='acme/factbox/insert'>`. |
| `title`, `description` | Names it in menus and for screen readers |
| `hotkey` | A shortcut such as `mod+shift+f`, where `mod` is ⌘ on macOS and Ctrl elsewhere |
| `handler` | Does it. Return `true` to let the default happen as well (such as the key's own effect, or a mark's toggle), nothing or `false` when the handler did everything. |
| `visibility` | `(element, rootElement) => [visible, enabled, active]`: whether menus show it, can use it, and show it as on |
| `when` | `(editor) => boolean`: take the hotkey only when this is true, so plugins can share a key |

The handler gets `editor`, the plugin's `type` and `options`, `args` from `useAction`, the
`event` that set it off, and `consumeFiles`.

A mark plugin (class `leaf`) has no element; its action's handler returns `true` and textbit
toggles the mark. It styles marked text with `getStyle`, returning CSS declarations or a class
name:

```ts
export const Highlight = (): TBPluginDefinition => ({
  class: 'leaf',
  name: 'acme/highlight',
  actions: [{ name: 'toggle', title: 'Highlight', hotkey: 'mod+shift+h', handler: () => true }],
  getStyle: () => ({ backgroundColor: 'yellow' })
})
```

Two plugins can share a key, such as Tab in a table and in a code block, if each gives its
action a `when`. Only the first action whose hotkey matches and whose `when` is true gets the
key.

### Consuming files and text

A plugin can take input: files dropped or picked, and typed or pasted text. `consumes` answers
whether it wants an input and what it will produce; `consume` turns the input into what goes
in the document:

```ts
consumer: {
  consumes: ({ input }) => [input.data instanceof File && input.type === 'text/csv', 'acme/table'],
  consume: async ({ input }) => {
    const resource = Array.isArray(input) ? input[0] : input
    const rows = parseCsv(await (resource.data as File).text())
    return { source: resource.source, type: 'acme/table', data: tableNode(rows) }
  }
}
```

The element in `data` is inserted where the file was dropped, or after the selected block.
Return `undefined` to decline after all. While `consume` runs, `Textbit.UploadMarker` keeps
the place.

An action that opens a file dialog hands the files on with `consumeFiles`, which every
handler gets, whether it runs from a menu, the toolbar or a shortcut:

```ts
handler: ({ consumeFiles }) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'text/csv'
  input.addEventListener('change', () => consumeFiles?.(Array.from(input.files ?? [])))
  input.click()
}
```

### Names

Give your plugins a namespace of your own, such as `acme/`. `base/` belongs to the standard
plugins and `core/` to textbit itself. A name stands for one document format; see
[Concepts](./concepts.md#types-and-names).

A plugin registered under the name of one already registered replaces it. That is how you
change core's built-in plugins, such as the toolbar key:

```tsx
import { FocusToolbar } from '@dotvoid/textbit'

const plugins = [...myPlugins, FocusToolbar({ hotkey: 'alt+f9' })]  // or { hotkey: false }
```

## Using plugins without React

`@dotvoid/textbit-plugins/definitions` has every ready-made plugin with the same name and
options, without its view:

```ts
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Image } from '@dotvoid/textbit-plugins/definitions'

const editor = createTextbitEditor({ plugins: [Text(), Bold(), Image()], value })
```

For your own plugins, import the definition file. See [Without a user interface](./headless.md).

## Next

- [Schema and validation](./schema-and-validation.md): describing your elements for
  `validate`, `getSchema` and agents.
- [Styling](./styling.md)
