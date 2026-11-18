# Collaboration

Textbit edits a Y.js document as readily as an array: give `Textbit.Root` a `Y.XmlText`
instead, and every editor on the same document sees the others' changes as they are made.
Textbit does not include a network connection. Any Y.js provider works: `y-websocket`,
Hocuspocus, `y-webrtc`, or your own.

## A shared editor

```tsx
import { useEffect, useMemo } from 'react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { Textbit } from '@dotvoid/textbit'
import { Text, Bold, Italic } from '@dotvoid/textbit-plugins'

type User = { name: string, color: string }

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

`onChange` still works: it is called with the document as an array after any change, anyone's.
The editor reads `value` when it mounts; to switch documents, give the root a new `key`.

## Cursors and presence

With `awareness`, each person's cursor and selection are shown to the others, labelled with
`cursor.data`:

| `cursor` field | Default | |
|---|---|---|
| `data` | | What others see: `name` and `color` label the cursor. Add anything else you need. |
| `autoSend` | `true` | Whether the cursor is sent as it moves |
| `stateField` | Slate's | The awareness field of the cursor's position |
| `dataField` | Slate's | The awareness field of `data` |

Awareness also carries the places files are being uploaded to, so others see an upload marker
where an image will appear, and the presence of agents; see [Agents](./agents.md).

A read-only editor shows other people's changes as they arrive, but does not show their
cursors.

## Filling a new document

A new `Y.XmlText` is empty. Fill it once, where the document is created, rather than in each
client: two clients that both find it empty and both fill it would give the document twice.

```ts
import * as Y from 'yjs'
import { slateNodesToInsertDelta } from '@slate-yjs/core'
import type { Descendant } from 'slate'

export function createSharedDocument(initial: Descendant[]): Y.Doc {
  const ydoc = new Y.Doc()
  ydoc.get('content', Y.XmlText).applyDelta(slateNodesToInsertDelta(initial))
  return ydoc
}
```

The content is not checked on the way in. Fill it with what an editor would have written, or
write it through a headless editor as shown below, so it is repaired before anyone sees it.

## Repairs in a shared document

Textbit repairs documents to keep them within the plugins' rules: it adds the caption an image
must have, removes a second one, gives a pasted copy a new id. In a shared document every
editor repairs what arrives, in the same tick, so a document stays repaired whoever made the
change. That has consequences:

- **Use the same plugins in every editor of a document.** An editor repairs to the rules of
  the plugins it has. Two editors with different rules for the same type would keep repairing
  each other's changes.
- **Write through a textbit editor.** Anything that changes a shared document outside an
  editor, such as a server or a script, should write through `createTextbitEditor`, so what it
  writes is repaired before it reaches the document. Written straight to the `Y.XmlText`, it
  would be repaired by every connected editor on arrival, each making the same repair.
- **Remote changes keep their ids.** An editor gives a new id to a block it inserts when the id
  is taken, but never rewrites what arrives from someone else: that would change only its own
  copy, which would then disagree with everyone's.
- **Exact copies are removed.** When two people insert the same block at the same moment, such
  as when both accept the same suggestion, the document ends up with two blocks with the same
  id and content. Every editor removes the later one, and since they all remove the same one,
  they agree. Blocks that share an id but differ are left alone: they hold someone's work.

Content no plugin knows is never repaired; see
[Objects whose plugin is missing](./the-editor.md#objects-whose-plugin-is-missing). An editor
missing a plugin leaves that plugin's objects as they are, rather than repairing them to rules
it does not have.

## Writing from a server

```ts
import * as Y from 'yjs'
import { Editor, Transforms } from 'slate'
import { YjsEditor } from '@slate-yjs/core'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { Text, Bold } from '@dotvoid/textbit-plugins/definitions'

export function appendParagraph(ydoc: Y.Doc, text: string) {
  const editor = createTextbitEditor({
    plugins: [Text(), Bold()],
    shared: ydoc.get('content', Y.XmlText)
  })

  YjsEditor.connect(editor)
  try {
    Transforms.insertNodes(editor, {
      id: crypto.randomUUID(),
      type: 'base/text',
      class: 'text',
      properties: {},
      children: [{ text }]
    }, { at: [editor.children.length] })
  } finally {
    YjsEditor.disconnect(editor)
  }
}
```

The `ydoc` is whatever your server holds for the document, such as the one a Hocuspocus
extension or a `y-websocket` server keeps in memory. See [Without a user interface](./headless.md).

## Undo

Each person's undo takes back their own changes, not other people's. Accepting or rejecting a
suggestion is the person's own change and is undone like one.

## Agents and suggestions

An AI agent can join a shared document as a collaborator, with its own presence and its
changes marked in the text, or propose changes as suggestions for people to accept or reject.
See [Agents](./agents.md) and [Suggestions](./suggestions.md).

## Next

- [Without a user interface](./headless.md)
- [Agents](./agents.md)
- The API reference has the root's props and `createTextbitEditor`'s options.
