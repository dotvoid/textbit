# Collaboration

Textbit edits a shared Y.js 14 document as readily as an array. Give `Textbit.Root` a **text
field** instead, and every editor on the same document sees the others' changes as they are
made.

A text field is a `Y.Node` whose children are the blocks of the text, such as `doc.get('body')`.
A document may hold several, a title and a body for example, each edited by an editor of its
own. Textbit binds the editor to the field itself; it needs `@y/y` 14 and nothing else from the
Y.js world.

Textbit does not include a network connection. Host documents with
[y-quorum](./y-quorum.md), the server in this repository, and its
[client](./y-quorum-client.md), or with any Y.js 14 provider, such as `@y/websocket`.

## A shared editor

```tsx
import { useMemo } from 'react'
import type * as Y from '@y/y'
import type { Awareness } from '@y/protocols/awareness'
import { Textbit } from '@dotvoid/textbit'
import { Text, Bold, Italic } from '@dotvoid/textbit-plugins'

type User = { name: string, color: string }

export function SharedEditor({ field, awareness, user }: {
  field: Y.Node
  awareness: Awareness
  user: User
}) {
  const plugins = useMemo(() => [Text(), Bold(), Italic()], [])

  return (
    <Textbit.Root
      value={field}
      awareness={awareness}
      cursor={{ data: { name: user.name, color: user.color } }}
      plugins={plugins}
    >
      <Textbit.Editable aria-label='Article' />
    </Textbit.Root>
  )
}
```

- **With y-quorum,** the field is a text field of the document's content and the awareness the
  handle's: `handle.content.getAttr('body')` and `handle.awareness`. See
  [The y-quorum client](./y-quorum-client.md).
- **With another provider,** the field is a node of the provider's `Y.Doc`, such as
  `doc.get('body')`, and the awareness the provider's.
- **The editor binds at once.** It shows the field as soon as it mounts and follows it from then
  on. There is nothing to connect, disconnect or flush: each change goes into the field as it is
  made.
- **`onChange` still works:** it is called with the document as an array after any change,
  anyone's.
- **To switch documents,** give the root a new `key` along with the new field.

## Cursors and presence

With `awareness`, each person's cursor and selection are shown to the others, labelled with
`cursor.data`. A cursor is sent as Y.js relative positions, so it follows the text while others
type. It is sent only while the editor is in use: with several editors on one document in a
page, the one without focus never moves or clears the person's cursor.

| `cursor` field | Default | |
|---|---|---|
| `data` | | What others see: `name` and `color` label the cursor. Add anything else you need. |
| `autoSend` | `true` | Whether the cursor is sent as it moves |
| `stateField` | `'selection'` | The awareness field of the cursor's position |
| `dataField` | `'data'` | The awareness field of `data` |

The cursor may be written inline: the editor binds again only when what it says changes, not
for every new object. The format is in [Formats](./formats.md#cursors).

Awareness also carries the places files are being uploaded to, so others see an upload marker
where an image will appear, and the presence of agents; see [Agents](./agents.md).

A read-only editor shows other people's changes as they arrive, but does not show their
cursors.

## Filling a new document

A new text field is empty. Fill it once, where the document is created, with `seedField`, rather
than in each client: two clients that both find it empty and both fill it would give the text
twice, or lose one of them.

```ts
import * as Y from '@y/y'
import { seedField } from '@dotvoid/textbit/headless'
import type { Descendant } from 'slate'

export function createSharedDocument(initial: Descendant[]): Y.Doc {
  const doc = new Y.Doc()
  seedField(doc.get('body'), initial)
  return doc
}
```

`seedField` refuses a field that has content. y-quorum fills the fields itself when a document
is created with content, such as `server.create(namespace, id, type, { body })`.

`fieldToValue(field)` reads a field back as an array of elements, to store as JSON or to check.

## Repairs in a shared document

Textbit repairs documents to keep them within the plugins' rules: it adds the caption an image
must have, removes a second one, gives a pasted copy a new id. In a shared document, an editor
repairs only what its own edits leave behind. That has consequences:

- **Loading and following others never write.** An editor that opens a document, or shows what
  others change, changes nothing in it. A person who only reads never becomes an author, and
  two editors never make the same repair at once, which would duplicate or delete content.
- **What arrives broken is the owner's to repair.** Content written outside an editor, by an
  editor with other plugins, or merged from two people's changes at once (a block both moved is
  there twice, as Y.js moves by copying), is shown as it is. The document's owner repairs it with
  `repairField`; y-quorum's server does so a moment after such changes. Editors do not remove
  the copies themselves: two removing them at once could remove both. See
  [Without a user interface](./headless.md#repairing-a-shared-document).
- **Use the same plugins in every editor of a document.** Each editor repairs its own edits to
  the rules of the plugins it has. Two editors with different rules for the same type would
  keep undoing each other's work.
- **Write through a textbit editor.** Anything that changes a shared document outside an
  editor, such as a server or a script, should write through `createTextbitEditor`, so what it
  writes is repaired before it reaches the document.
- **Remote changes keep their ids.** An editor gives a new id to a block it inserts when the id
  is taken, but never rewrites what arrives from someone else.

Content no plugin knows is never repaired; see
[Objects whose plugin is missing](./the-editor.md#objects-whose-plugin-is-missing). An editor
missing a plugin leaves that plugin's objects as they are, rather than repairing them to rules
it does not have.

## Writing from a server

```ts
import type * as Y from '@y/y'
import { Transforms } from 'slate'
import { createTextbitEditor, sharedOf } from '@dotvoid/textbit/headless'
import { Text, Bold } from '@dotvoid/textbit-plugins/definitions'

export function appendParagraph(field: Y.Node, text: string) {
  const editor = createTextbitEditor({ plugins: [Text(), Bold()], shared: field })
  try {
    Transforms.insertNodes(editor, {
      id: crypto.randomUUID(),
      type: 'base/text',
      class: 'text',
      properties: {},
      children: [{ text }]
    }, { at: [editor.children.length] })
  } finally {
    sharedOf(editor)?.release()
  }
}
```

The field is whatever your server holds for the document: with y-quorum, a field of a handle's
content from the client in Node. See [Without a user interface](./headless.md).

## The editor's link to the field

`sharedOf(editor)` gives the link of an editor bound to a field, from `Textbit.Root` (through
`useEditor()`) or from `createTextbitEditor`:

| | |
|---|---|
| `field` | The text field |
| `origin` | The origin of the editor's own changes in Y.js transactions. Give `createTextbitEditor` an `origin` to recognise them elsewhere. |
| `undoManager` | The editor's undo, a `Y.UndoManager` for its own changes only |
| `withOrigin(origin, change)` | Makes changes through the editor under another origin, such as an agent's working in the person's editor: neither in the person's undo nor theirs in the history |
| `currentOrigin()` | The origin changes are made under now |
| `isApplyingRemote()` | Whether the editor is applying someone else's change: plugins leave those alone |
| `check()` | Whether the editor shows exactly what the field holds |
| `reread()` | Brings the editor to what the field holds; returns whether anything differed |
| `release()` | Unbinds the editor. It keeps its content and stops following the field. |

`bindField(editor, field, options)` binds a Slate editor of your own the same way.

## Undo

Each person's undo takes back their own changes, not other people's, nor what an agent did in
their editor. Accepting or rejecting a suggestion is not in it: see
[Suggestions](./suggestions.md#accepting-and-rejecting).

## Agents and suggestions

An AI agent can join a shared document as a collaborator, with its own presence and its
changes marked in the text, or propose changes as suggestions for people to accept or reject.
Suggestions live in a fork of the text, shown through Y.js 14's diff renderer. See
[Agents](./agents.md) and [Suggestions](./suggestions.md).

## Next

- [Without a user interface](./headless.md)
- [y-quorum](./y-quorum.md) and [its client](./y-quorum-client.md)
- [Agents](./agents.md)
- The API reference has the root's props and `createTextbitEditor`'s options.
