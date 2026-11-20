# Without a user interface

`createTextbitEditor` builds the editor `Textbit.Root` uses, with the same plugins and the same
rules, but without React or a browser. Use it to read, change or check documents on a server,
in a script, in a test or in an agent's tools.

## Why it exists

A document is only as consistent as the code that writes it. If a server wrote documents with
its own code, it would have to know every rule the plugins keep: that an image has exactly one
caption, that a list holds list items, which ids are taken. A headless editor applies those
rules for it, in the same repairs the editor makes as people type. What a script writes is then
what an editor would have written.

That is why plugins are split into a definition and a view. The definition holds everything but
the look, and needs nothing from React or the DOM, so the headless editor can load it anywhere.

## Changing a document

```ts
import { Editor, Transforms } from 'slate'
import type { Descendant } from 'slate'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold, Image } from '@dotvoid/textbit-plugins/definitions'

const plugins = [Text(), Bold(), Image()]

export function addByline(document: Descendant[], byline: string): Descendant[] {
  const editor = createTextbitEditor({ plugins, value: document, lang: 'en' })

  // Repair what the document brought with it, as an editor would on load
  Editor.normalize(editor, { force: true })

  Transforms.insertNodes(editor, {
    id: crypto.randomUUID(),
    type: 'base/text',
    class: 'text',
    properties: {},
    children: [{ text: byline, 'base/bold': true }]
  }, { at: [editor.children.length] })

  return editor.children
}
```

Every Slate transform and query works on it, as do textbit's helpers. Each change is repaired
as it is made, as in the editor.

## Options

| Option | |
|---|---|
| `plugins` | The plugin definitions. Plugins with views work too; the views are not used. Without any, core's plain paragraph. |
| `value` | The document, when it is not shared |
| `lang` | The document's language, `'en'` when not given |
| `shared` | A `Y.XmlText` to collaborate through. See below. |
| `localOrigin` | The origin of this editor's own changes to the shared document |
| `awareness`, `cursor` | Share a cursor, as for `Textbit.Root` |
| `onSpellcheck`, `spellcheckDebounce` | Spellcheck the text, as for `Textbit.Root` |
| `editor` | A Slate editor to build on, instead of a new one |

## The entries

**`@dotvoid/textbit/headless`** loads neither React nor anything that needs a browser; a test
in textbit keeps it that way. It has:

- `createTextbitEditor`
- `TEXT_TYPE`, and core's plain paragraph plugin `Text`
- the helpers `TextbitEditor`, `TextbitElement` and `TextbitPlugin`
- `getSchema`, `validate` and `toJsonSchema`; see [Schema and validation](./schema-and-validation.md)
- the suggestion functions for an editor showing a fork, `suggestedChanges`, `acceptChange`
  and `rejectChange`; see [Suggestions](./suggestions.md)
- `AGENT_PRESENCE_FIELD` and `diffWords`, for agents; see [Agents](./agents.md)
- the types a plugin definition needs: `TBPluginDefinition`, `TBElementSpec`, `TBAction`,
  `TBElementSchema` and the rest

The main entry, `@dotvoid/textbit`, has all of these as well, for code that has React anyway.

**`@dotvoid/textbit-plugins/definitions`** has every ready-made plugin with the same name and
options as in the main entry, without its view.

For your own plugins, keep the definition in a file that imports nothing from React, and
import that file. See [Plugins](./plugins.md#writing-a-plugin).

## A shared document

With `shared`, the editor reads and writes a Y.js document. Connect it to start and disconnect
it when done; disconnecting sends what it has not sent yet:

```ts
import * as Y from 'yjs'
import { Transforms } from 'slate'
import { YjsEditor } from '@slate-yjs/core'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text } from '@dotvoid/textbit-plugins/definitions'

export function replaceTitle(ydoc: Y.Doc, title: string) {
  const editor = createTextbitEditor({ plugins: [Text()], shared: ydoc.get('content', Y.XmlText) })

  YjsEditor.connect(editor)
  try {
    Transforms.insertText(editor, title, { at: [0] })
  } finally {
    YjsEditor.disconnect(editor)
  }
}
```

Anything that writes to a shared document outside an editor should write this way. What it
writes is repaired before it reaches the document, instead of by every connected editor on
arrival. See [Collaboration](./collaboration.md#repairs-in-a-shared-document).

## What it is not

The editor's type is the same as in the browser, and includes slate-react's `ReactEditor`, so
one plugin's code serves both. There is no DOM behind a headless editor, though: anything that
needs one, such as `ReactEditor.focus` or finding an element's DOM node, fails. Keep such code
in the plugin's view, or in action handlers that only run in the browser.

## Next

- [Schema and validation](./schema-and-validation.md)
- [Collaboration](./collaboration.md)
- [Agents](./agents.md): editing with AI agents, built on the headless editor.
- The API reference has `createTextbitEditor` and every helper.
