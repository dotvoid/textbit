# Where comments and suggestions live

Background for a decision that is hard to undo: where textbit keeps comments and suggestions,
and how they are anchored to the text they are about. Written in November 2026, with Y.js 14
at release candidate 30.

## What it has to do

- **Agent suggestions:** precise placement that survives people typing around them, accept or
  reject per change, and never published by mistake.
- **People's suggestions** (a suggesting mode, as in track changes): all of that, and the
  suggested text is real, editable text: you type it, fix your own typo in it, move the caret
  through it.
- **Comments:** a range of text that follows edits, with threads. The text does not change.
- **Read-only is read-only:** someone who may comment, or suggest, but not edit must be held to
  that by the server, not only by the editor's interface.
- **No special handling in copy and paste,** and no annotation data left behind in the content.
- **Both ways of storing:** Y.js is the preferred way, but hosts that store the document as JSON
  must be served too.
- **Nothing to uproot when Y.js 14 arrives.**

## What Y.js 14 does

As of release candidate 30 (`@y/y@14.0.0-rc.30`, 14 November 2026):

- **Suggestions are a separate document,** a fork of the base, by convention named
  `<doc>--suggestions`. The difference between the two is rendered as marks that exist only on
  screen, never in the CRDT. Accepting writes the chosen changes into the base; whoever accepts
  needs write access to it. Y.js itself keeps suggestions out of the content.
- **Relative positions are unchanged.** Their encoding is byte for byte the same in 13 and 14;
  positions encoded with one resolve to the same place with the other. The stored update format
  is compatible as well.
- **Attribution,** who wrote what, is kept outside the document.
- **There is no first-party support for comments.** Editors that have them (Tiptap, BlockNote)
  anchor them with marks in the content, so their commenters need write access to the
  document, and comment permissions are enforced only by the interface.
- **14 is not stable:** there are open bugs in how updates integrate, and no date for a release.
  Its own ProseMirror binding tells most users to stay on Y.js 13 for now.

## The architectures

1. **Full marks in the content,** as word processors do: suggested text is in the document,
   marked as inserted; text to remove stays, marked as deleted.
2. **Reference marks in the content, details beside:** a mark with only an id on the text a
   comment or suggestion concerns; what it says, or would change, lives elsewhere under that id.
3. **A map in the same Y.Doc, anchored by whole-block snapshots:** each suggested block is
   stored with a hash of the block as it was; accepting replaces the block.
4. **A map in the same Y.Doc, anchored operations:** each suggestion is a list of small
   operations (insert this text here, delete from here to there, set properties, insert or
   delete a block), anchored with Y.js relative positions.
5. **Companion documents, each anchor stored two ways:** comments and suggestions in documents
   of their own beside the content, `<doc>--comments` and `<doc>--suggestions`; every anchor
   both a Y.js relative position and a text selector (the element's id, the offset, the quoted
   text and a little context either side).
6. **The Y.js 14 fork:** suggestions are edits in a forked document, shown as a difference.

| | 1. Full marks | 2. Reference marks | 3. Same Y.Doc, block snapshots | 4. Same Y.Doc, anchored operations | 5. Companion documents, two-way anchors | 6. Y.js 14 fork |
|---|---|---|---|---|---|---|
| Unaccepted text cannot leak into published output | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Content JSON holds only content | ✗ | ✗ ¹ | ✓ | ✓ | ✓ | ✓ |
| Copy and paste need no special handling | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ |
| Comments under read-only, enforced by the server | ✗ | ✗ | ✗ ² | ✗ ² | ✓ | ~ ³ |
| A suggest-only role, enforced by the server | ✗ | ✗ | ✗ ² | ✗ ² | ✓ | ~ ⁴ |
| Works for hosts that store JSON | ✓ | ✓ | ~ ⁵ | ✗ | ✓ ⁶ | ✗ |
| Survives concurrent typing (does not go stale) | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| Accept or reject per change, not per block | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| Pure insertions anchor naturally | ✓ | ~ ⁷ | ~ | ✓ | ✓ | ✓ |
| Suggested text is editable (people's suggesting mode) | ✓ | ✗ | ✗ | ✗ | ✗ ⁸ | ✓ |
| Part of the content's undo and history | ✓ | ~ ⁹ | ✗ | ✗ | ✗ ¹⁰ | ✗ ¹⁰ |
| Other editors and versions show the right text | ✗ | ✓ | ✓ | ✓ | ✓ | ✗ ¹¹ |
| Matches where Y.js 14 is going | ✗ | ~ ¹² | ~ | ~ | ✓ | ✓ |
| Possible on Y.js 13 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Work | High | Medium | Built (in 3.0 development) | Medium | Medium to high | High: a new Slate binding |

1. Reference attributes on the text: harmless, but not clean.
2. The editor can refuse to change the content, but the server sees one document: it cannot
   allow a write to the map and refuse one to the content.
3. Y.js 14 has no comments; a comments layer would be added, which is option 5.
4. Suggesting needs only write access to the fork, but the fork holds a copy of the content, so
   a server cannot easily check that a suggester only added suggestions.
5. Blocks are matched by id, so the data would survive in JSON, but there is no way for a host
   to save it.
6. Through the selectors, found again within the element they name. Under Y.js the relative
   positions are used.
7. A pure insertion has no text to mark: it needs a rule, anchoring to the neighbouring
   character or to the element.
8. Until the Y.js 14 fork arrives, which then becomes option 5's `--suggestions` layer.
9. The anchors are in the content's history, the details are not.
10. Each layer has a history of its own. An accepted change is in the content's history, as the
    accepting person's edit.
11. Old and new clients cannot collaborate on one document during the move to 14.
12. Close to how editors anchor comments today, not to how Y.js 14 does suggestions.

## The choice: option 5

It is the only option that meets both hard requirements, comments and suggestions under
read-only enforced by the server, and nothing in the content to clean up, and the only one that
leads into Y.js 14 instead of away from it.

- **The content holds content and nothing else.** Copy and paste, serialization, other editors,
  validation and the agent's view of the document are untouched.
- **Each layer is a document of its own,** so a server gives each its own permissions: a reader
  may comment, a suggester may suggest and comment, an editor may do everything and accept. With
  Hocuspocus all of them travel over one connection.
- **Every anchor is stored two ways.** The relative position is precise, survives concurrent
  editing, and survives the move to 14. The selector serves hosts that store JSON and documents
  restored from JSON: textbit's elements all have stable ids, so the quoted text only has to be
  found again within one element. Whole blocks are anchored by their id alone.
- **Suggestions are small operations,** not block snapshots: accepting applies one operation
  where it now is, and only an edit to the very text it touches makes it out of date.
- **Comments whose text is gone** are shown as detached, with what they were about. Nothing is
  removed behind anyone's back.

What it costs: anchoring is textbit's own code, where marks would get it from the CRDT; the
layers have histories of their own instead of being part of the content's; and a host keeps two
or three documents instead of one, or a JSON store, which is the price of permissions a server
can enforce.

**People's suggesting mode,** with editable suggested text, comes with the Y.js 14 binding:
typing in the `--suggestions` fork, shown with Y.js 14's own difference renderer. Suggestions
stored as operations before then remain readable and can be replayed into the fork. Comments
need no change at all.

## Sources

- Y.js releases and the `@y/y` package: https://github.com/yjs/yjs/releases, https://www.npmjs.com/package/@y/y
- `@y/prosemirror`, its suggestion rendering and its compatibility notes: https://github.com/yjs/y-prosemirror
- BlockNote's comments: https://www.blocknotejs.org/docs/features/collaboration/comments
- Tiptap's comments: https://tiptap.dev/docs/comments/core-concepts/manage-threads
- The W3C Web Annotation data model, for text selectors: https://www.w3.org/TR/annotation-model/
