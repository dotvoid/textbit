# Suggestions

A suggestion is a change proposed for people to accept or reject, instead of a change made.
Textbit makes them the way Y.js 14 does: in a **fork** of the shared text, a copy that the text
keeps flowing into. What is typed in the fork stays there until someone accepts it into the
text. Everyone sees the difference between the two: what would be added, underlined, and what
would be removed, struck.

Suggestions need a shared document: the text in a Y.js 14 `Y.Doc`, and its fork in another.

## The fork and its view

The fork is a `Y.Doc` of its own, with garbage collection off so it keeps what it deletes:

```ts
import * as Y from '@y/y'

const fork = new Y.Doc({ gc: false, isSuggestionDoc: true })
Y.applyUpdate(fork, Y.encodeStateAsUpdate(doc))
const renderer = Y.createDiffRenderer(doc, fork)
```

`createDiffRenderer` shows the fork as its difference with the text, and keeps the fork in step:
whatever the text gets flows into it. Bind the editor to the fork's field through it:

```tsx
<Textbit.Root value={fork.get('body')} renderer={renderer} awareness={awareness}>
  <Textbit.Editable aria-label='Article' />
  <Textbit.Suggestions />
</Textbit.Root>
```

With [y-quorum](./collaboration.md), the client keeps the fork for you: `handle.suggestionsDoc`
is it, and `handle.suggestionsRenderer()` the renderer, with who suggested what from the
server. Destroy a renderer when the view it is for goes, such as in a React effect's cleanup:
until then it keeps passing what is typed in the fork on by its own `suggestionMode`. When the
content or the fork is rebuilt after a refusal, the client destroys the renderers bound to them;
make a new one on `rebuilt`.

## Suggesting, or editing with suggestions shown

`renderer.suggestionMode` decides where typing goes:

- `true`: into the fork. What a person types, deletes or formats is suggested. Fixing a typo in
  one's own suggestion keeps it a suggestion.
- `false`: into the text, through the fork. The person edits as usual and sees what others
  suggest around it.

y-quorum's `suggestionsRenderer({ suggesting })` sets it; it may change at any time. Every
local change to the fork goes into the text while it is `false`, whichever editor made it; with
several editors on one fork, `suggestionsRenderer({ origins: [origin] })` (Y.js's
`renderer.suggestionOrigins`) limits that to the transactions of the origins given, such as the
editor's own.

## What people see

Suggested text carries the `_suggested` mark, `'insert'` or `'delete'`, and through the
attributions `_by` and `_at`, who suggested it and when. The leaf has `data-tb-change` and
`data-tb-by`, and the editable `data-tb-view='suggestions'`. The default styles underline what
would be added and strike what would be removed.

## Reviewing

`Textbit.Suggestions` lists the changes in the order of the text, each with what it does and
who suggested it, Accept and Reject, and Accept all and Reject all when there are several. It is
how keyboard and screen reader users review: the marks in the text are for the eye. Give it
`people`, names by the keys attributions use (y-quorum's `handle.people`), to say who.

To build your own, `useSuggestions()` gives:

| | |
|---|---|
| `enabled` | Whether the editor shows a fork through a diff renderer |
| `changes` | Each change: `kind` (`insert`, `delete` or `replace`), `inserted`, `deleted`, `by`, `at`, `block` (a whole block suggested), `range` in the editor |
| `accept(change)`, `reject(change)` | Decide one change |
| `acceptAll()`, `rejectAll()` | Decide all |

Without React, `suggestedChanges(editor)`, `acceptChange(editor, change)` and
`rejectChange(editor, change)` do the same for an editor bound to the fork through the renderer.

A change is a run of suggested content side by side by one person: an insertion right next to a
deletion is one replacement. Where two people's suggestions touch, they are listed apart, but
Y.js decides the whole run at once: accepting or rejecting one decides the other too, such as
Bob's "the" right after Alice's struck "teh". A whole block suggested, added or removed, is one
change with everything in it.

## Accepting and rejecting

Accepting writes the suggested items themselves into the text, so the text keeps who wrote them
and the fork who suggested them. Rejecting takes the suggestion out of the fork and records in
the text that it was rejected. Neither is in the person's undo: the editor's undo covers the
fork, and a decision changes the text, so undoing one in the text would remove the suggestion
instead of bringing it back. To go back on a decision, suggest the change again.

With y-quorum the server holds everyone to their role:

| | Suggest | Withdraw own | Accept | Reject others' |
|---|---|---|---|---|
| reader, commenter | | | | |
| suggester | yes | yes | | |
| editor, owner | yes | yes | yes | yes |

Accepts and rejections are entries of their own in the document's history.

## From an agent

An agent suggests by editing the fork. Give it an editor bound to the fork's field, plainly,
without a renderer:

```ts
const forkEditor = createTextbitEditor({ plugins, shared: handle.suggestionsDoc.get('content').getAttr('body') })
const agent = createDocumentAgent(editor, { plugins, presence, review: 'suggest', suggestIn: forkEditor })
```

While `review` is `'suggest'` the agent reads, searches and edits the fork: the document with
the suggestions made so far. What it changes there is suggested, moving blocks included. Its
tools tell the model so. Without `suggestIn` it refuses to suggest. `review` may change between
calls.

## Taking back an agent's work

With y-quorum, for a type with history and suggestions, `handle.suggestRevert({ run, by, since })`
suggests taking back what a run, an actor (by key, such as `agent:copy`) or a stretch of time
changed: its inverse goes into the fork, what it added suggested away and what it removed
suggested back. Nothing in the text changes until a person accepts, change by change or all at
once. It is suggested even where the renderer lets typing into the text.

## Limits

- The fork is the whole text: there is one set of suggestions per document, not one per
  person.
- Changing only a block's properties, such as a heading level, shows in the fork but is not yet
  listed as a change of its own.
