# @dotvoid/textbit-plugins

Ready to use plugins for [`@dotvoid/textbit`](https://github.com/dotvoid/textbit/tree/main/packages/textbit): headings, formatting,
lists, links, tables, code, quotes, images and audio.

The plugins are headless. They render semantic HTML with `tb-*` classes and no
styling of their own, apart from what text needs to read right, like bold being
bold. Add [`@dotvoid/textbit-styles`](https://github.com/dotvoid/textbit/tree/main/packages/styles) for a default look, or style the
classes yourself.

```bash
npm install @dotvoid/textbit @dotvoid/textbit-plugins
```

```tsx
import { Textbit } from '@dotvoid/textbit'
import { Text, Bold, Italic, Link, UnorderedList, OrderedList } from '@dotvoid/textbit-plugins'

const plugins = [Text(), Bold(), Italic(), Link(), UnorderedList(), OrderedList()]

<Textbit.Root value={value} onChange={setValue} plugins={plugins}>
  <Textbit.Editable aria-label='Article' />
</Textbit.Root>
```

Create the plugin list once, for example with `useMemo`, not on every render.

## Only what you import

Every plugin is a named export, and the package is built so bundlers keep only
the plugins you import. Importing `Bold` does not bring `Table` along. The build
checks this for every plugin against its ES modules output.

## Plugins

Every type and mark is named `base/*`, the namespace for textbit's standard
content. A `base/image` is always this package's image, with this package's
document format, in every application that uses textbit.

So a plugin of your own gets a namespace of your own, also when it does the same
job as one of these: your own image plugin is `acme/image`, not `base/image`.
Registered as `base/image`, it would replace this one under the same name with a
different document format, and documents, copy and paste, and anything else that
reads `base/image` could no longer tell the two apart. To change how one of these
plugins looks or behaves, use its options and the styles.

The one exception is `base/text`. Textbit itself creates `base/text` blocks, on
Enter, on paste and in an empty document, so a plugin that renders text in your
own way has to keep that name and its format: no role for a paragraph, and
`properties.role` for anything else.

| Plugin | Element types | Default shortcut |
|--------|---------------|------------------|
| `Text` | `base/text`, role `heading-1` to `heading-6` or `preamble` | Ctrl+Alt+0 to 4 (⌘⌥0 to 4) |
| `Bold`, `Italic`, `Underline` | marks `base/bold`, `base/italic`, `base/underline` | Ctrl/⌘+B, I, U |
| `Strikethrough` | mark `base/strikethrough` | none |
| `Code` | mark `base/code` | none |
| `UnorderedList`, `OrderedList` | `base/unordered-list`, `base/ordered-list` | Ctrl/⌘+Shift+8, Ctrl/⌘+Shift+7 |
| `CodeBlock` | `base/code-block` | none |
| `Table` | `base/table` | none |
| `Link` | inline `base/link` | Ctrl/⌘+K |
| `LocalizedQuotationMarks` | none, it changes typed quotes | none |
| `Image` | `base/image` | none |
| `Audio` | `base/audio` | none |
| `Blockquote` | `base/blockquote` | none |

`Text` replaces textbit's built-in plain paragraph and keeps its format, adding
roles for headings and the lead-in.

### Text

Paragraphs, headings and a lead-in. A paragraph has no role; a heading has the
role `heading-1` to `heading-6` and renders as `h1` to `h6`; a lead-in, the
larger opening paragraph of an article, has the role `preamble` and renders as a
`p`. The lead-in has no default shortcut.

| Option | Type | Description |
|--------|------|-------------|
| `headings` | `(1 \| 2 \| 3 \| 4 \| 5 \| 6)[]` | Levels to offer. Default `[1, 2, 3, 4]`. |
| `preamble` | `boolean` | Offer the lead-in. Default `true`. |
| `singleLine` | `boolean` | No Enter and no soft breaks, for a title field. |
| `titles` | `Partial<Record<TextRole, string>>` | Action names, e.g. translations. |
| `placeholders` | `Partial<Record<TextRole, string>>` | Hint in an empty block, per role. |
| `hotkeys` | `Partial<Record<TextRole, string \| false>>` | Replace or remove a role's shortcut. |

### Formatting marks

`Bold`, `Italic`, `Underline`, `Strikethrough` and `Code` take `{ hotkey, title }`.
The first four style themselves inline. `Code` renders with the class `tb-code`,
since a monospace font and a background belong in a stylesheet.

### Lists

`UnorderedList` and `OrderedList` take `{ title, placeholder, hotkey }`. Use both
to switch a list between bullets and numbers. Enter on the last item adds an item;
Enter on an empty last item leaves the list.

### Code block and table

`CodeBlock({ indentSize, title, placeholder, hotkey })`: Tab indents inside the
block. `Table({ rows, columns, titles })`: Tab and Shift+Tab move between cells,
and Tab in the last cell adds a row. Its actions insert and delete rows and
columns; they show in menus while the caret is in a cell.

Both use Tab only in their own context, through textbit's `when()` on actions, so
they work side by side.

### Link

`Link({ hotkey, labels })`. Ctrl/⌘+K links the selection and moves to its address
field; Ctrl/⌘-click opens a link in a new tab. Addresses are checked whenever a
link is rendered, not only when typed, so a `javascript:` address arriving through
paste, a collaborator or stored data never becomes a live link. `labels` names the
address field and buttons, e.g. for translation.

### Localized quotation marks

Turns typed `"` and `'` into the quotation marks of the editor's language (“…” in
English, ”…” in Swedish, «…» in Norwegian), and two hyphens into an en dash.

### Image and audio

Reference plugins: complete, and meant to be read when you build your own. Give
yours a namespace of your own, such as `acme/image` (see [Plugins](#plugins)).

```tsx
Image({
  upload: async (file) => {
    const { url, width, height } = await myStorage.put(file)
    return { src: url, width, height }   // or undefined to drop the file
  }
})
```

Dropped and picked files go to your `upload` function, and its answer becomes the
image. Without `upload` the plugin only renders images and offers no way to add
one: textbit never stores a file in the document itself. While the upload runs,
textbit's upload marker shows it, if you place `Textbit.UploadMarker` in the editor.

| Option | Description |
|--------|-------------|
| `upload` | `(file: File) => Promise<{ src, width?, height?, alt? } \| undefined>` |
| `accept` | MIME types. Image default: JPEG, PNG, GIF, WebP, AVIF. Audio default: MP3, MP4/AAC, Ogg, WAV, WebM. |
| `maxSize` | Largest file, in bytes. |
| `labels` | Action name, field labels and hints, and other text. |

Images have alternative text, so screen readers can describe them. It is a text
field in the document (`base/image/alt`) between the image and its caption: the
caret moves in and out of it like any other text, and no `<input>` captures
the keyboard. Images without the field get an empty one when normalized.

The caption and the alternative text are labelled fields (`.tb-field`, with
`.tb-field-label` and `.tb-field-text`); a click on a label puts the caret in its
field. Only `http`, `https`, `blob` and image or audio `data` addresses are
rendered.

`imageNode()` and `audioNode()` build a complete block, for inserting media you
already store.

### Blockquote

`Blockquote({ labels, hotkey })`: a quote and its source. Leave the source empty
when there is none.

## Translation

The plugins ship English defaults for every visible and announced text: action
titles, placeholders, labels. Each plugin's options replace them.

```tsx
Text({ titles: { 'heading-1': 'Rubrik 1' }, placeholders: { 'heading-1': 'Rubrik' } })
Link({ labels: { title: 'Länk', address: 'Länkadress' } })
```

## Shortcuts

A shortcut that a browser or operating system already uses never reaches the page,
so defaults are only set where the key is known to be free. They were checked
against Chrome's published shortcuts (which Edge shares) and Firefox's developer
tools.

- **No default** for `Code`, `CodeBlock` and `Strikethrough`. The usual keys are
  taken: Ctrl+Shift+C opens the element picker in Chrome and Firefox, and
  Ctrl+Shift+K opens Firefox's web console. Set your own with `hotkey`.
- **Ctrl/⌘+K** for links overrides Chrome's address bar search on Windows and Linux,
  as Google Docs does; pages are allowed to.
- Firefox's browser shortcut list could not be checked for the heading and list
  keys. They follow Google Docs.

Every plugin takes `hotkey: false` (or `hotkeys` for `Text`) to remove a shortcut.

## Credits

Icons are from [Lucide](https://lucide.dev), used under the ISC License; the notice
is in `lib/shared/icons.tsx`.
