# Upgrading from 2.x

Textbit 3 splits every plugin into a definition, which needs no React, and a view, so the same
plugin runs in an editor, on a server, in a script and in an agent's tools. Most of the work of
upgrading is moving a plugin's components into its view. Hosts that only use the ready-made
plugins have little to change.

**Documents do not change.** A 2.x document opens in 3.0 as it is, and the ready-made plugins
keep their names, options and document formats.

## Versions

```bash
npm install @dotvoid/textbit@3 @dotvoid/textbit-plugins@1 @dotvoid/textbit-styles@1
```

| Package | 2.x era | Now |
|---|---|---|
| `@dotvoid/textbit` | 2.1 | 3.0 |
| `@dotvoid/textbit-plugins` | 0.1 | 1.0 |
| `@dotvoid/textbit-styles` | 0.2 | 1.0 |
| `@dotvoid/textbit-agent` | | 1.0, new |

The peer dependencies are unchanged: React 18 or 19, Slate and slate-react 0.147, Y.js and
slate-yjs.

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

### Types

| 2.x | 3.0 |
|---|---|
| `TBPluginDefinition`, a plugin with its components | `TBPlugin`, a definition with its `view`, which is what `Textbit.Root` takes. `TBPluginDefinition` is now the definition alone, which is what `createTextbitEditor` takes. |
| `TBComponentEntry` | `TBElementSpec` for the element, `TBComponentView` for its component |
| `TBChildComponentEntry` | `TBChildElementSpec` and `TBComponentView` |
| `TBPluginInitFunction` | Kept, now returning `TBPlugin`. Prefer `(options): TBPlugin => ({ … })`, which TypeScript checks for fields that do not belong. |
| `SelectionStats` | `TBSelectionStats` |
| `PendingDrop` | `TBPendingDrop` |

Every type now carries the `TB` prefix, keeping them apart from Slate's `Element`, `Text` and
`Editor`.

### A 2.x plugin registered as it is

It has no `element`, so its elements show as
[objects whose plugin is missing](./the-editor.md#objects-whose-plugin-is-missing), kept as
they are. The console names each field to move: `componentEntry`, `events` and an action's
`tool`.

## The registry

`usePluginRegistry()` reflects the split. Each entry in `components` has the element's `spec`
and its `view`, in place of `componentEntry`:

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

## Packaging

- **The UMD build is gone.** The package is ES modules and CommonJS. The files are
  `dist/index.js` and `dist/index.cjs`, where they were `dist/index.es.js` and
  `dist/index.umd.cjs`. Imports of the package name are unaffected; imports of the files
  themselves must change.
- **A second entry, `@dotvoid/textbit/headless`,** has the editor without React: see
  [Without a user interface](./headless.md).
- **`@dotvoid/textbit-plugins/definitions`** has the ready-made plugins without their views.
- Declarations now name their files, so TypeScript with `NodeNext` module resolution finds the
  types.

## Behaviour

- **Exact copies are removed.** An editor removes a top-level block that has the same id and
  the same content as an earlier one. This happens when two people insert the same block at
  once, such as when both accept the same suggestion. Blocks that share an id but differ are
  kept. See [Collaboration](./collaboration.md#repairs-in-a-shared-document).
- **Remote changes keep their ids.** In a shared document, an editor no longer gives a new id
  to an element that arrives from someone else, even if the id is taken in its own copy;
  rewriting it made the copies disagree.
- **Files with nothing selected** go after the last block.
- **The editor no longer needs a browser** to load: `lang` and the imports work on a server.

Everything else behaves as in 2.x: every peer repairs what arrives, Tab leaves the editor, an
action's handler returns `true` to let the default happen.

## New in 3.0

Not needed to upgrade, but there to use:

- `createTextbitEditor`, the editor without a user interface: [Without a user interface](./headless.md)
- `getSchema`, `validate`, `toJsonSchema`, and a `schema` and `description` on plugins:
  [Schema and validation](./schema-and-validation.md)
- Agents in the document, and `@dotvoid/textbit-agent`: [Agents](./agents.md)
- Suggestions, with `Textbit.Suggestions` and `useSuggestions`: [Suggestions](./suggestions.md)
- New labels on `Textbit.Root` for agents and suggestions, and the `agentChangeDuration` prop:
  [The editor](./the-editor.md)

The API reference has every type and function by its 3.0 name.
