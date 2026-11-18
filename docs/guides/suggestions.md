# Suggestions

A suggestion is a change proposed for people to accept or reject, block by block, instead of a
change made. An agent in suggest mode makes them; anything else can too. Until someone decides,
the document stays as it was, and every editor shows what would change.

## Making suggestions

**From an agent.** Pass `review: 'suggest'`:

```ts
const agent = createDocumentAgent(editor, { plugins, presence, review: 'suggest' })
```

Each batch the agent sends is planned and checked exactly as an edit would be: its handles,
its content, the document's rules. Instead of being applied, the difference is stored as one
suggestion. The edit tool tells the model so in its description, its result says "Suggested"
and shows the blocks as they would be, and reads say how many suggestions wait.

`author` names who a suggestion is from (`{ name, color }`); by default the presence's name,
else `Agent`. Moving a block cannot be suggested yet: the agent gets `not-allowed` and a hint to
suggest the content where it should go and its removal where it is.

**From anything else.** Compute it from two versions of the document and store it:

```ts
import { suggestionFor, suggestionStore } from '@dotvoid/textbit'

const suggestion = suggestionFor(editor.children, proposedChildren, { name: 'Copy desk', color: '#1971c2' })
if (suggestion) {
  suggestionStore(editor).put(suggestion)
}
```

`suggestionFor` compares the top-level blocks by id and gives the blocks that change, are
inserted and are deleted, or `null` when nothing differs. Both functions are also in
`@dotvoid/textbit/headless`.

## What people see

Every editor in the document shows each block of a suggestion where it applies:

- **A changed block:** the words it would remove struck through, the words it would add beside
  them, tinted in the author's colour and underlined. A change of more than words, such as
  formatting, is noted in the bar.
- **A deleted block:** struck through whole.
- **An inserted block:** a preview of its text where it would go.
- **On each,** who suggests it, and **Accept** and **Reject**. Read-only editors show who,
  without the buttons.

Unlike what an agent changes directly, suggestions do not fade. They wait.

The marks are not part of the document: they cannot be edited, the caret skips them, copies
leave them out, and screen readers do not read them as text. New suggestions are announced
instead: "Writing assistant suggests changes to 3 blocks".

## Reviewing

**`Textbit.Suggestions`** lists every suggestion, with what each block does ("Change “teh” to
“the”", "Add “…”", "Delete “…”"), its Accept and Reject, and Accept all and Reject all. It is
what keyboard and screen reader users review with, and a review panel for anyone. Place it
inside `Textbit.Root`; it renders nothing while there are none.

```tsx
<Textbit.Root value={shared} awareness={provider.awareness} plugins={plugins}>
  <Textbit.Editable aria-label='Article' />
  <Textbit.Suggestions aria-label='Suggestions' />
</Textbit.Root>
```

**`useSuggestions()`** gives the same to build your own:

| Field | |
|-------|---|
| `suggestions` | The suggestions in the document, oldest first |
| `shown` | Each suggested block as the editor shows it, in document order: `suggestion`, `block`, `state` (`'ready'` or `'stale'`), and for a change `texts` (the word changes per text element) and `formatting` |
| `accept(suggestionId, blockId?)` | Accept a block, or every block of the suggestion that can be |
| `reject(suggestionId, blockId?)` | Reject a block, or all of it |

Without React, use `acceptSuggestedBlock`, `rejectSuggestedBlock`, `acceptSuggestion`,
`rejectSuggestion`, `suggestedBlockState` and `suggestedTextChanges` from the headless entry.

## Accepting, rejecting, undoing

- **Accepting is the person's own edit.** It goes into their undo: undoing it brings back the
  text and the suggestion.
- **Rejecting** leaves the document as it is. In a shared document the person who rejected can
  undo it too.
- **Out of date.** A block someone changed after it was suggested is `stale`: it can only be
  rejected. Its bar says "changed since".
- **An inserted block** goes after the block it was suggested after. If that one is itself an
  insert of the same suggestion not yet accepted, it goes after that one's anchor, and so on.

## With several people

Everyone in the document sees the same suggestions and may accept or reject them.

- **Each block is decided on its own.** Two people deciding different blocks of the same
  suggestion at the same moment both count.
- **Accepting a block removes it from the suggestion** as part of the same change. Once that
  has reached the others, they cannot accept it again.
- **Two people accepting the same block at the same moment,** before either has seen the other,
  each insert it. Editors then take out the second, an exact copy of the first: the same id and
  the same content, which no edit means to make. Blocks that share an id but differ are left,
  as they hold someone's work.
- **Undo is per person:** each undoes their own decisions, whatever others decided after.

## Where suggestions are kept

In a shared document, in a map of the same `Y.Doc`, beside the content: `textbitSuggestions`,
with one entry per suggested block. Everyone sees them, and they outlive whoever made them. In
a document that is not shared, they are kept in memory with the editor, for everything in the
same page. The entries are specified in [Formats](./formats.md#suggestions).

**What that means for storing documents.** The content never holds a suggestion: the editor's
value, `onChange`, and anything read from the content type (`yTextToSlateElement`) are the
document without them. The `Y.Doc` does hold them: whatever stores a `Y.Doc` as a whole, such
as `Y.encodeStateAsUpdate(doc)` or a Hocuspocus `onStoreDocument`, stores the suggestions
waiting for review with it, and they are there again when it is loaded. That is the point: a
review can wait for someone. To keep a document without them, store its content, or empty the
map first.

## Limits

- **Moves** cannot be suggested yet.
- **Formatting changes** (marks, properties) show as a note on the bar, not word by word.
- **An addition to an empty text field** has no character to sit beside: the bar shows the
  suggestion, the text does not.
- **Without Y.js,** a reject cannot be undone.
