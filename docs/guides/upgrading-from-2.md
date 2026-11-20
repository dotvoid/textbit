# Upgrading from 2.x

Three things change in textbit 3, and most apps meet only some of them:

- **Plugins are a definition and a view.** The definition needs no React, so the same plugin
  runs in an editor, on a server, in a script and in an agent's tools. Apps that only use the
  ready-made plugins have little to change.
- **Shared documents move to Y.js 14,** with textbit's own binding in place of slate-yjs. Apps
  that edit together change their Y.js packages, their provider and the value they give the
  editor.
- **Types carry the `TB` prefix,** and a few parts of the API changed before 3.0 was frozen.

What carries over, and what does not:

- **Documents carry over.** A 2.x document in JSON opens in 3.0 as it is, and the ready-made
  plugins keep their names, options and formats. A document stored as Y.js 13 state by a 2.x
  app loads in Y.js 14 as it is, see [Documents stored by 2.x](#documents-stored-by-2x).
- **2.x and 3.x cannot edit one document at once.** They use different versions of Y.js, which
  do not sync with each other. Move every user of a shared document, and the server, to 3.0
  together.

Textbit 3.0 is released when Y.js 14.0 is. Until then it is built against a pinned release
candidate of Y.js 14, `@y/y` 14.0.0-rc.30.

## Versions

| Package | 2.x era | 3.0 |
|---|---|---|
| `@dotvoid/textbit` | 2.1 | 3.0.0 |
| `@dotvoid/textbit-plugins` | 0.1 | 1.0.0 |
| `@dotvoid/textbit-styles` | 0.2 | 1.0.0 |
| `@dotvoid/textbit-agent` | | 1.0.0, new |
| `@dotvoid/y-quorum`, `@dotvoid/y-quorum-client` | | new: a server for shared documents and its client |

```bash
npm install @dotvoid/textbit@3 @dotvoid/textbit-plugins@1 @dotvoid/textbit-styles@1 \
  @y/y@14 @y/protocols
npm uninstall yjs @slate-yjs/core @slate-yjs/react y-protocols
```

The editor's peer dependencies:

| 2.x | 3.0 |
|---|---|
| `react`, `react-dom` 18 or 19 | unchanged |
| `slate`, `slate-react` 0.147 | unchanged |
| `yjs` 13, `@slate-yjs/core`, `@slate-yjs/react` | `@y/y` 14 and `@y/protocols` |

The Y.js packages are needed even by an app that does not edit together, as in 2.x. The
plugins need `@dotvoid/textbit` 3.

## Plugins

### `componentEntry` is now `element` and `view`

The element and its children, with their constraints, stay in the definition, under `element`.
The components move to `view.components`, keyed by full type: the plugin's name for its own
element, `name/child` for a child, `name/child/grandchild` below that.

Before:

```tsx
const Figure: TBPluginInitFunction = () => ({
  class: 'block',
  name: 'acme/figure',
  actions: [{ name: 'insert', title: 'Figure', tool: () => <FigureIcon />, handler: insertFigure }],
  componentEntry: {
    class: 'block',
    component: FigureComponent,
    children: [{
      type: 'caption',
      class: 'text',
      asOwnElement: true,
      component: Caption,
      constraints: { min: 1, max: 1 }
    }]
  }
})
```

After:

```tsx
import type { TBPlugin } from '@dotvoid/textbit'

const Figure = (): TBPlugin => ({
  class: 'block',
  name: 'acme/figure',
  actions: [{ name: 'insert', title: 'Figure', handler: insertFigure }],
  element: {
    class: 'block',
    children: [{ type: 'caption', class: 'text', constraints: { min: 1, max: 1 } }]
  },
  view: {
    components: {
      'acme/figure': { component: FigureComponent },
      'acme/figure/caption': { asOwnElement: true, component: Caption }
    },
    tools: { insert: () => <FigureIcon /> }
  }
})
```

### An action's `tool` moves to `view.tools`

Keyed by the action's name, as above. A pair of tools, `[tool, toolWhenOneInlineSelected]`,
works as before.

### `asOwnElement` moves to the view

Next to the component it is about, as above. A component with `asOwnElement: true` still
spreads `attributes` on its root element.

### `events` is gone

Nothing ever called `onInsertText` or `onNormalizeNode`. Use `constraints.normalizeNode` for
repairs, and actions or a consumer for input.

Before:

```ts
events: {
  onNormalizeNode: (editor, entry) => fixFigure(editor, entry)
}
```

After:

```ts
element: {
  class: 'block',
  constraints: { normalizeNode: (editor, entry) => fixFigure(editor, entry) }
}
```

### `api` in action handlers is now `consumeFiles`

`ActionHandlerArgs.api` was an untyped object, given only by menu items, holding
`consumeFileInputChangeEvent`. In its place every handler gets `consumeFiles(files)`, from
menus, the toolbar and shortcuts alike.

Before:

```ts
handler: ({ editor, api }) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.addEventListener('change', (event) => api?.consumeFileInputChangeEvent(editor, event))
  input.click()
}
```

After:

```ts
handler: ({ consumeFiles }) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.addEventListener('change', () => consumeFiles?.(Array.from(input.files ?? [])))
  input.click()
}
```

Files handed over with nothing selected now go after the last block.

### An action's `event` is narrower

`ActionHandlerArgs.event` was a React keyboard or mouse event. It is now `TBActionEvent`, with
`preventDefault()` and `stopPropagation()` only, since actions also run where there is no React
event. A handler that read the key or the mouse button from it should use `hotkey` and `when`
instead.

### Placeholders are text

`placeholder` on an element is a string, or a function of the element returning a string. A
function returning React content no longer type-checks. Render richer hints in the component.

### Leaf styles

`getStyle` returns CSS declarations as `TBLeafStyle`, a record of strings and numbers, or a
class name. It was typed as `React.CSSProperties`; most such objects still fit.

### Classes

An element's class is one of `'text'`, `'block'`, `'void'` or `'inline'` (`TBElementClass`). It
was typed as any string. `'leaf'` and `'generic'` remain plugin classes only.

### A 2.x plugin registered as it is

It has no `element`, so its elements show as
[objects whose plugin is missing](./the-editor.md#objects-whose-plugin-is-missing), kept as
they are. The console names each field to move: `componentEntry`, `events` and an action's
`tool`.

## Types

| 2.x | 3.0 |
|---|---|
| `TBPluginDefinition`, a plugin with its components | `TBPlugin`, a definition with its `view`, which is what `Textbit.Root` takes. `TBPluginDefinition` is now the definition alone, which is what `createTextbitEditor` takes. |
| `TBComponentEntry` | `TBElementSpec` for the element, `TBComponentView` for its component |
| `TBChildComponentEntry` | `TBChildElementSpec` and `TBComponentView` |
| `TBPluginInitFunction` | Kept, now returning `TBPlugin`. Prefer `(options): TBPlugin => ({ … })`, which TypeScript checks for fields that do not belong. |
| `SelectionStats` | `TBSelectionStats` |
| `PendingDrop` | `TBPendingDrop` |

Every type now carries the `TB` prefix, keeping them apart from Slate's `Element`, `Text` and
`Editor`. Values keep plain names. The props of the components and what the hooks give are
exported too, such as `TBRootProps`, `TBEditableProps` and `TBPluginRegistry`.

## The registry

`usePluginRegistry()` reflects the split. Each entry in `components` has the element's `spec`
and its `view`, in place of `componentEntry`.

Before:

```ts
const { components } = usePluginRegistry()
const allowBreak = components.get('acme/figure/caption')?.componentEntry.constraints?.allowBreak
```

After:

```ts
const { components } = usePluginRegistry()
const allowBreak = components.get('acme/figure/caption')?.spec.constraints?.allowBreak
```

An action's `plugin` is the `TBPlugin`, and its `tool` comes from the plugin's view.

## Shared documents

In 2.x a shared document was a `Y.XmlText` in a Y.js 13 document, bound to the editor by
slate-yjs, and carried by any Y.js 13 provider such as Hocuspocus or `y-websocket`. In 3.0 it is
a text field in a Y.js 14 document, bound by textbit itself.

- **The value is a text field:** a `Y.Node` holding the field's blocks, such as
  `ydoc.get('content')`, in place of `ydoc.get('content', Y.XmlText)`.
- **Import from `@y/y`** in place of `yjs`, and the awareness from `@y/protocols/awareness` in
  place of `y-protocols/awareness`.
- **The provider must speak Y.js 14.** Hocuspocus and other providers built on Y.js 13 cannot
  carry a 3.0 document. y-quorum is textbit's own server for it, with a client that keeps the
  documents and their awareness: see [y-quorum](./y-quorum.md) and
  [The y-quorum client](./y-quorum-client.md).

### A shared editor

Before:

```tsx
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export function SharedEditor({ documentId, user }: { documentId: string, user: User }) {
  const ydoc = useMemo(() => new Y.Doc(), [documentId])
  const provider = useMemo(
    () => new WebsocketProvider('wss://collab.example.com', documentId, ydoc),
    [ydoc, documentId]
  )
  const content = useMemo(() => ydoc.get('content', Y.XmlText), [ydoc])
  const plugins = useMemo(() => [Text(), Bold(), Italic()], [])

  useEffect(() => () => {
    provider.destroy()
    ydoc.destroy()
  }, [provider, ydoc])

  return (
    <Textbit.Root
      value={content}
      awareness={provider.awareness}
      cursor={{ data: { name: user.name, color: user.color } }}
      plugins={plugins}
    >
      <Textbit.Editable aria-label='Article' />
    </Textbit.Root>
  )
}
```

After, with the y-quorum client and a document type whose text field is `body`:

```tsx
import * as Y from '@y/y'
import { createClient, type DocumentHandle } from '@dotvoid/y-quorum-client'

type User = { name: string, color: string, token: string }

export function SharedEditor({ documentId, user }: { documentId: string, user: User }) {
  const plugins = useMemo(() => [Text(), Bold(), Italic()], [])
  const [handle, setHandle] = useState<DocumentHandle>()

  useEffect(() => {
    const client = createClient({ url: 'wss://collab.example.com', token: user.token })
    let opened: DocumentHandle | undefined
    client.open('articles', documentId).then((document) => {
      opened = document
      setHandle(document)
    })
    return () => {
      opened?.release()
      client.close()
    }
  }, [documentId, user.token])

  const body = handle?.content.getAttr('body')
  if (!handle || !(body instanceof Y.Node)) {
    return null
  }

  return (
    <Textbit.Root
      value={body}
      awareness={handle.awareness}
      cursor={{ data: { name: user.name, color: user.color } }}
      plugins={plugins}
    >
      <Textbit.Editable aria-label='Article' />
    </Textbit.Root>
  )
}
```

The props are otherwise the same: `onChange` is called with the document as an array after
anyone's change, `cursor` takes the same fields (`data` is now optional), and a read-only editor
follows others without showing their cursors. `renderer` is new, for showing a field through a
Y.js 14 renderer, such as the suggestions of a fork.

### Filling a new document

Before:

```ts
import * as Y from 'yjs'
import { slateNodesToInsertDelta } from '@slate-yjs/core'

const ydoc = new Y.Doc()
ydoc.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta(initial))
```

After:

```ts
import * as Y from '@y/y'
import { seedField } from '@dotvoid/textbit'

const ydoc = new Y.Doc()
seedField(ydoc.get('content'), initial)
```

Fill a field once, where the document is created, as before. `fieldToValue(field)` reads a field
back as an array. With y-quorum the server creates a new document's fields from its type and the
initial values it is given.

### Writing from a server

A 2.x server that changed a shared document wrapped a Slate editor with slate-yjs's `withYjs`
and called `YjsEditor.connect` and `disconnect`. In 3.0, `createTextbitEditor` binds to the field
itself, with the plugins' rules, and `release()` unbinds it:

```ts
import { Transforms } from 'slate'
import { createTextbitEditor, sharedOf } from '@dotvoid/textbit/headless'

const editor = createTextbitEditor({ plugins, shared: ydoc.get('content') })
try {
  Transforms.insertNodes(editor, paragraph, { at: [editor.children.length] })
} finally {
  sharedOf(editor)?.release()
}
```

`plugins` are the definitions, from `@dotvoid/textbit-plugins/definitions`. With y-quorum,
writers in other processes use the client from Node with a service token, and agents the MCP
module.

### Documents stored by 2.x

A document a 2.x app stored as Y.js 13 state loads into a Y.js 14 document as it is. Its field
is the root type the 2.x app used, `content` in textbit's examples:

```ts
const ydoc = new Y.Doc()
Y.applyUpdate(ydoc, stored)
const field = ydoc.get('content')
```

An editor bound to it edits it as any other. Textbit 2 kept an element's properties in one
attribute, where 3.0 keeps each in an attribute of its own; a property changed in 3.0 moves to
its own attribute, and the rest are read as they are.

y-quorum keeps a document as a typed tree, with the text in a field such as `body`, so a 2.x
document goes in through its content as JSON. With `host` storage, load the stored state and
hand over its value:

```ts
import * as Y from '@y/y'
import { fieldToValue } from '@dotvoid/textbit/headless'
import { host, type HostStore } from '@dotvoid/y-quorum'

const articles: HostStore = {
  async load(_namespace, id) {
    const stored = await loadYjs13State(id)
    if (!stored) {
      return undefined
    }
    const doc = new Y.Doc()
    Y.applyUpdate(doc, stored)
    return { type: 'article', content: { body: fieldToValue(doc.get('content')) } }
  },
  async store(_namespace, id, document) {
    await saveJson(id, document)
  }
}

const storage = host(articles)
```

The document starts its history in y-quorum: what slate-yjs kept of who typed what does not come
along.

### Repairs

Textbit repairs a document to keep it within the plugins' rules: the caption an image must
have, a pasted copy's new id.

- **In 2.x every editor repaired what arrived** from others, each making the same repair.
- **In 3.0 an editor repairs only its own changes.** Loading a document and following others
  never write. A change from someone else is shown as it is.

Two changes that are each valid can still meet in a block that breaks a rule, such as two
people deleting the only caption at once. That is for the document's owner, the server, to
repair once for everyone: a headless editor bound to the field and normalized
(`Editor.normalize(editor, { force: true })`) does it. y-quorum does not do this yet, see
[What's new in 3.0](./whats-new-in-3.md#not-yet). Until then, as in 2.x, write through a
textbit editor everywhere, never straight into the Y.js types, and give every editor of a
document the same plugins.

## Suggestions, from an early 3.0 build

Builds of 3.0 before 20 November 2026 kept suggestions in a map in the content's Y.Doc,
`textbitSuggestions`, decided block by block. They are now a fork of the shared text, the way
Y.js 14 does it, see [Suggestions](./suggestions.md). Suggestions stored in the map are not
carried over: decide them before upgrading.

| Before | After |
|---|---|
| The editor read the map from the content's Y.Doc | An editor bound to the fork's field, through a diff renderer: `value={fork.get('body')} renderer={renderer}` |
| `suggestionStore`, `suggestionFor`, `SUGGESTIONS_MAP` | Edit the fork: what is typed there is suggested |
| `useSuggestions()`: `suggestions`, `shown`, `accept(id, blockId?)`, `reject(id, blockId?)` | `useSuggestions()`: `enabled`, `changes`, `accept(change)`, `reject(change)`, `acceptAll()`, `rejectAll()` |
| `acceptSuggestedBlock`, `rejectSuggestedBlock`, `acceptSuggestion`, `rejectSuggestion` | `suggestedChanges(editor)`, `acceptChange(editor, change)`, `rejectChange(editor, change)` |
| `TBSuggestion`, `TBSuggestedBlock`, `TBSuggestionStore`, `TBReviewResult`, `TBShownSuggestion` | `TBSuggestedChange`, `TBSuggestions` |
| An agent with `review: 'suggest'` | Also `suggestIn`: an editor on the fork's field |

```ts
const forkEditor = createTextbitEditor({ plugins, shared: fork.get('content') })
const agent = createDocumentAgent(editor, { plugins, review: 'suggest', suggestIn: forkEditor })
```

Accepting or rejecting is no longer in the person's undo. Moves can be suggested.

## Packaging

- **The UMD build is gone.** The package is ES modules and CommonJS. The files are
  `dist/index.js` and `dist/index.cjs`, where they were `dist/index.es.js` and
  `dist/index.umd.cjs`. Imports of the package name are unaffected; imports of the files
  themselves must change.
- **A second entry, `@dotvoid/textbit/headless`,** has the editor without React: see
  [Without a user interface](./headless.md).
- **`@dotvoid/textbit-plugins/definitions`** has the ready-made plugins without their views.
- **Declarations name their files,** so TypeScript with `NodeNext` module resolution finds the
  types.

## Behaviour

- **Editors repair only their own changes,** see [Repairs](#repairs).
- **Remote changes keep their ids.** An editor no longer gives a new id to an element that
  arrives from someone else, even if the id is taken in its own copy; rewriting it made the
  copies disagree.
- **Exact copies are removed.** An editor's repair removes a top-level block with the same id
  and the same content as an earlier one. Blocks that share an id but differ are kept.
- **Files with nothing selected** go after the last block.
- **Plugins add to the context menu.** An action can ask for a place in it, as a table's rows
  and columns do. Where one is offered, the menu opens whatever the `contextMenu` mode, plugin
  actions before your items, and without a `ContextMenu.Root` of yours the editor shows its own.
- **`useSelectionBounds()`** no longer has `leafEntry` and `blockEntry`, which were never set.
- **The editor no longer needs a browser** to load: `lang` and the imports work on a server.

Everything else behaves as in 2.x: Tab leaves the editor, an action's handler returns `true` to
let the default happen, an agent's changes are marked for a moment and fade.

## New in 3.0

Not needed to upgrade, but there to use: agents, comments, suggestions, the editor without a
user interface, schemas and validation, and the y-quorum server. See
[What's new in 3.0](./whats-new-in-3.md). The API reference has every type and function by its
3.0 name.

## Checklist

1. Install the 3.0 packages and `@y/y` 14 and `@y/protocols`; remove `yjs`, `@slate-yjs/core`,
   `@slate-yjs/react` and `y-protocols`.
2. Move each plugin of your own to `element` and `view`: components and `asOwnElement` to
   `view.components`, tools to `view.tools`, `events` to `constraints.normalizeNode`.
3. Replace `api` in action handlers with `consumeFiles`, and reading keys or buttons from
   `event` with `hotkey` and `when`.
4. Rename the types: `TBPlugin` for a plugin with its view, `TBElementSpec` and
   `TBComponentView` for `TBComponentEntry`, `TBSelectionStats`, `TBPendingDrop`.
5. Read `spec` in place of `componentEntry` from `usePluginRegistry()`.
6. Change imports of `dist/index.es.js` or `dist/index.umd.cjs`, if you have any.
7. If you edit together: import from `@y/y` and `@y/protocols`, give `Textbit.Root` a text
   field in place of a `Y.XmlText`, fill new documents with `seedField`, and drop
   `YjsEditor.connect`.
8. Move to a Y.js 14 provider and server, such as y-quorum, and bring stored documents along.
9. Write to shared documents through a textbit editor only, with the same plugins everywhere.
10. Plan the switch so every user of a shared document moves to 3.0 at the same time.
