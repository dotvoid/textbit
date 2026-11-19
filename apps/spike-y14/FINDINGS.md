# Spikes: textbit on Y.js 14

Written 19 November 2026, against `@y/y` 14.0.0-rc.30. The questions are those of
`docs/internal/server-plan.md`, "Order of work", step 0. Run with `npm test -w textbit-spike-y14`;
the convergence gate at size with `SPIKE_SEEDS=200 SPIKE_STEPS=1000`.

## 1. A Slate binding on Y.js 14

`src/model.ts`, `src/binding.ts`, `tests/binding.test.ts`. It works.

- **Mapping.** A text field is a node whose children are its blocks. An element is a nameless
  node with `type`, `id` and `class` as attributes and each property as an attribute of its own
  (`p:<name>`); marks are formats; inline elements are child nodes. Slate-yjs documents from
  Y.js 13 (with one `properties` attribute) load as they are and can be edited; a changed
  property moves to its own attribute.
- **Type is an attribute, not the node's name,** so changing an element's type keeps its
  identity, and comments anchored in it.
- **Inserted text takes exactly the formats it is given:** Y.js 14 does not carry formatting
  over from the text before it.
- **Slate to Y.js:** each operation is translated from the editor's state before it.
- **Y.js to Slate:** not by replaying deltas. The blocks a change touched are read from Y.js
  and the editor is brought to them with the smallest Slate operations found by comparing;
  when blocks were added or removed, the whole field is compared. An editor therefore cannot
  drift by replaying a change wrongly: each change compares it with Y.js again.
- **Loading and remote changes never write.** Remote operations mark nothing for
  normalization (`getDirtyPaths` returns nothing for them); turning normalization off with
  `shouldNormalize` instead makes Slate recurse for ever. A test confirms no update leaves a
  client that only loads and follows others.
- **What the two sides can hold differs in one place:** marks on an empty text. Slate keeps
  them so the next character typed takes them; Y.js has no character to keep them on.
  Comparisons ignore them.
- **Speed:** 0.34 ms per keystroke, writer and reader together, in a 300-block article.
  Comparing the whole field on every change took 8 ms.
- **Cursors** as relative positions follow others' typing; per-editor undo works through
  `Y.UndoManager` with the editor's origin.

## 2. Several editable editors on one text field

`tests/binding.test.ts`, "several editors" and "convergence". **Keep them.**

- The convergence gate: two editors on one field in one document, a third on another client,
  random edits (typing, deleting across blocks, marks, splitting, merging, properties, moving,
  inserting and removing blocks), live and delayed sync. **200 seeds of 1,000 steps each,
  live and delayed: 400 runs, all converged, no re-reads needed.**
- Every editor is compared with Y.js after every step, not only at the end.
- Undo per editor, and a caret in the other editor staying at its character while text
  before it changes, both work.
- An editor changed behind the binding's back is found by `check()` and put right by
  `reread()` or by the next change to the same block. A change to another block leaves it to
  the check, which the plan runs on focus and after idle periods.
- "One translation applied to every editor", as the plan proposed, is not needed: comparing
  with Y.js is per editor and self-correcting, which is safer than sharing a replay.

## 3. The document tree

`src/tree.ts`, `tests/tree.test.ts`.

- **Attributes can hold nodes,** created as `new Y.Node(name)`; through a delta, an attribute's
  value must be a node instance, not a nested delta.
- Editors bind to text fields anywhere: a title on the document, a description in a list item.
- **Single values as attributes** set by two people at once end with one value on both.
- **Reordering by a position attribute keeps anchors** in the item's text; moving by deleting
  and inserting loses them (tested both).
- **Two items with one id:** the owner keeps the first by Y.js id and removes the other; both
  clients agree.
- **A text field created by two clients at once loses one person's text entirely** (tested).
  Rule: text fields are created with their parent, never on first use.
- A projection of chosen fields as JSON reads plain fields and text fields.
- **Client ids are 53-bit** in Y.js 14 (`random.uint53`), not 32-bit: among 10,000 ids a collision
  has a chance of about one in 200 million. Claiming ids in the handshake still stops writes
  under someone else's id.

## 4. Suggestions in the fork

`tests/suggest.test.ts`.

- **The fork covers the whole tree:** a text change, a changed plain field and a new list item
  all render as suggestions, and the base is untouched.
- **Each change is accepted or rejected on its own,** in any order: the date, the new item and
  the text change independently. Rejecting restores the base.
- **People's suggesting mode works through the binding** with a `renderer` option: deleted
  words stay, shown with `_suggested: 'delete'`; typed words show with `'insert'`; fixing a typo
  in one's own suggestion keeps it a suggestion; accepting and rejecting update every editor.
- What the binding needed: read and write through the renderer; follow its own changes too
  (a deletion stays, struck), once Slate has applied the operation; follow the renderer's
  `change` events, because accepting changes what is shown without changing the field.
- **Who suggested** is empty without an attribution map from the server, as expected.
- **Accepting needs Y.js item ids,** reachable only through internals (`_item`, `_map`,
  `_start`). We need a public way from a rendered change to the ids to pass to
  `acceptChanges`, from upstream or our own wrapper.

## 5. Y.js upstream

`tests/upstream.test.ts` keeps an eye on these.

- **Restoring a version after one of the later changes was itself undone deletes text.** A
  19-line reproduction, on rc.30 and `main`. Cause: `redoItem` in `src/utils/UndoManager.js`
  (around line 429) returns an earlier redo copy as "already restored" although the same
  operation is about to delete it. Skipping a copy that is in `stackItem.inserts` fixes it and
  the Y.js suite passes; that may not be the right fix for longer redo chains. Draft issue
  below, to be filed by a person.
- Text deleted by a revert comes back at its original place ("The ministerformer resigned"):
  as designed, not a bug. Reverts must be shown as suggestions.
- Packaging during the move: npm's `latest` for `@y/y` is rc.7, so versions must be pinned;
  `@y/protocols` still imports `yjs`; with Y.js 13 in the same install, `lib0` 0.2 is hoisted and
  Y.js 14 gets its own copy of `lib0` 1.0, so lib0's classes cannot be told apart with
  `instanceof` (the binding reads delta entries by their fields).

### Draft issue

**Title:** `undoContentIds` deletes text instead of restoring it when the set contains both a
deletion and its earlier undo (14.0.0-rc.30)

> **Version:** `@y/y` 14.0.0-rc.30, also `main` (ee37f0a0)
>
> Undoing a set of changes that includes a deletion and the later undo of that deletion removes
> the text, instead of bringing back the state before both. It happens when restoring an old
> version by undoing everything after it, once one of those later changes was itself an undo.
>
> ```js
> import * as Y from '@y/y'
>
> const doc = new Y.Doc({ gc: false })
> const text = doc.get('text')
> const ids = () => Y.createContentIdsFromDoc(doc, true)
>
> text.insert(0, 'abc')
> const v1 = ids()
> text.delete(1, 1)
> Y.undoContentIds(doc, Y.excludeContentIds(ids(), v1)) // "abc"
> Y.undoContentIds(doc, Y.excludeContentIds(ids(), v1)) // expected "abc", actual "ac"
> console.log(text.toString())
> ```
>
> **Cause:** in `redoItem` (`src/utils/UndoManager.js`, around line 429) an item with
> `redone !== null` returns its existing redo copy and makes no new one. Here that copy is also
> in `stackItem.inserts`, so `popStackItem` deletes it in the same transaction, and nothing is
> restored. Not returning the copy when it is in the set being deleted
> (`if (!itemsToDelete.hasId(copy.id)) return copy`, otherwise make a new copy) fixes this case
> and the test suite still passes; it may not be the right fix for longer redo chains.
