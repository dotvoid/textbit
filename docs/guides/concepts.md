# Concepts

A textbit document is a Slate document with a few conventions on top. Knowing them makes
everything else, plugins, schemas, collaboration and agents, easier to follow.

## A document is a list of elements

The document is an array of top-level elements, the blocks. Each element has:

| Field | What it is |
|---|---|
| `id` | A unique string, usually a UUID. Required on every element except text elements, where it is optional but normally present. Textbit gives inserted elements an id, and a new one when a copy would collide with an existing one. |
| `type` | What the element is, by name: `base/text`, `base/image`, `acme/factbox` |
| `class` | How the editor treats it: `text`, `block`, `void` or `inline`, see below |
| `properties` | Data the element stores: a heading's `role`, an image's `src`. Strings, numbers and booleans. |
| `children` | Its content: text, or other elements |

Text is stored in text nodes, `{ text: '…' }`. Formatting is a mark on a text node, keyed by
the mark plugin's name and set to `true`:

```ts
{
  id: '538345e5-bacc-48f9-8ef0-1219891b60ef',
  type: 'base/text',
  class: 'text',
  properties: {},
  children: [
    { text: 'An example paragraph with ' },
    { text: 'stronger', 'base/bold': true, 'base/italic': true },
    { text: ' text.' }
  ]
}
```

A heading is the same element type with a role:

```ts
{ id: '…', type: 'base/text', class: 'text', properties: { role: 'heading-1' }, children: [{ text: 'Better music?' }] }
```

## Classes

| Class | What it is | Examples |
|---|---|---|
| `text` | A block of text people write in | Paragraphs, headings, list items, a caption |
| `block` | An object: a block made of other elements | An image with its caption, a table, a quote with its source |
| `void` | Content with no text to edit, inside an object | The picture of an image, an audio player |
| `inline` | An element inside text | A link |

Objects, elements of class `block` or `void` at the top level, get object behaviour: a click
selects them whole, the arrow keys park a block caret before or after them, and they can be
dragged. People still type in the text elements inside them, such as a caption.

A list is of class `text` and holds its list items, which are text elements too.

## Types and names

Every type and mark has a namespace:

| Namespace | Used for |
|---|---|
| `base/*` | Text, marks and the standard blocks, from core and `@dotvoid/textbit-plugins` |
| `core/*` | Textbit's own features, such as `core/nbsp` and `core/toolbar`. Never stored in a document. |
| your own | Your plugins, such as `acme/factbox` or `acme/image`. Never `base/` or `core/`. |

A name stands for one document format: everything that reads a document, the editor, copy
and paste, a server, an agent, relies on `base/image` always being the same image. So your
own image plugin is `acme/image`, even when it does the same job. Registering a different
plugin as `base/image` would give the same name a different format, and nothing could tell
the two apart.

The exception is `base/text` (`TEXT_TYPE`): core itself creates it, on Enter, on paste, for
an empty document, and when it repairs an element that lost its type. A plugin that renders
text in its own way registers as `base/text` and keeps its format: no role for a paragraph,
`properties.role` for the rest. `Text()` from `@dotvoid/textbit-plugins` does this.

The children of an object have full types made from the parent's: the caption of a
`base/image` is `base/image/caption`.

## Plugins

A plugin adds element types, marks or behaviour. It has two halves:

- **The definition:** what it is. Its name, its element and the element's children, their
  constraints, its schema, its actions, and what files or text it consumes. It needs neither
  React nor a browser.
- **The view:** what it looks like. The React components that render its elements, and the
  icons shown for its actions.

The split lets the same plugin run in an editor, on a server, in a script and in an agent's
tools: everything but the view, with the same rules. See [Plugins](./plugins.md).

## Rules and repairs

A plugin's element can say how many of each child it has (an image has exactly one caption),
whether Enter may break it, and more. Textbit keeps documents within those rules as people
edit: it inserts a missing caption, removes a second one, and puts children in order. These
repairs are Slate's normalization, and run after every change, in the same tick, so what an
edit leaves behind is already repaired. In a shared document an editor repairs only its own
edits; see [Collaboration](./collaboration.md#repairs-in-a-shared-document).

Content textbit has no plugin for is never repaired or changed: see
[Objects whose plugin is missing](./the-editor.md#objects-whose-plugin-is-missing).

## Values

`Textbit.Root` takes the document in one of three forms:

| `value` | `onChange` gives | For |
|---|---|---|
| a string | a string, paragraphs separated by line breaks | A plain text field |
| an array of elements | the array | Documents you store yourself |
| a text field, a `Y.Node` of a Y.js 14 document | the array | Documents edited together, see [Collaboration](./collaboration.md) |

## Next

- [The editor](./the-editor.md)
- [Plugins](./plugins.md)
- [Schema and validation](./schema-and-validation.md): describing what a document may hold,
  and checking it.
