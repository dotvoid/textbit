# The 3.0 API: what was decided

Everything public in 3.0 was reviewed before it was frozen. After 3.0 only additions are
allowed. Public means the code (exports, names, types, options, defaults, result shapes), what
is stored in documents, what is sent between peers or shown to models, and the hooks
stylesheets target. Each point says what was decided and why: the rule was to change only what
would otherwise be wrong forever, and to keep everything else as 2.x hosts know it.

## Changed

1. **Types are `TB…`, values are plain.** Every type exported by `@dotvoid/textbit` and its
   headless entry carries the prefix, as most already did; it keeps them apart from Slate's
   `Element`, `Text` and `Editor`. Renamed: `TBEditorOptions`, `TBDocumentSchema`,
   `TBElementTypeSchema`, `TBValidationIssue`, `TBValidationCode`, `TBJsonSchema`,
   `TBSuggestion`, `TBSuggestedBlock`, `TBSuggestionStore`, `TBReviewResult`,
   `TBAgentPresence`, `TBAgentStatus`, `TBAgentChange` (as an agent publishes it),
   `TBShownAgentChange` (as an editor shows it, like `TBShownSuggestion`), `TBPresentAgent`,
   `TBSelectionStats`, `TBPendingDrop`, `TBTextChange`. The agent package keeps its own plain
   names, which are specific already (`DocumentAgent`, `AgentTool`, `EditOperation`).
2. **`ActionHandlerArgs.api` is gone**, an untyped bag marked FIXME, used only for handing
   picked files to the consumers. In its place: `consumeFiles(files: File[])`, given wherever
   the editor runs an action (menus, the toolbar, shortcuts), not only in menus. Files handed
   over with nothing selected now go after the last block.
3. **`describeSchema(schema)`** in the agent package: it needed an object nothing exported.
4. **`useSuggestions()`** gives `suggestions`, `shown` (each suggested block as the editor
   shows it, in document order), `accept` and `reject`. Its internal lookup tables, keyed by
   block id with `''` for the start, stay inside the editor. Superseded 20 November 2026, when
   suggestions moved to the Y.js 14 fork: it gives `changes`, `accept`, `reject`, `acceptAll`
   and `rejectAll`.
5. **`diffWords`** is in the main entry too, so both entries offer the same headless API.
6. **`Suggestions`** is exported on its own as well, like every other `Textbit.*` component.

## Kept, after weighing it

- **Both ways to import components,** `Textbit.Root` and `Root`: the named exports let a
  bundler leave out what a host does not use; removing either breaks hosts for nothing.
- **`Textbit.Plugins`,** core's plain paragraph: a host that passes plugins of its own and
  wants that paragraph needs it.
- **The Slate re-exports** (`Editor`, `Transforms`, …): they make sure Slate's types carry
  textbit's elements; Slate is a pinned peer either way.
- **The stored and sent formats get no version field now.** A reader takes an entry without
  one as version 1; a later format adds the field. Adding it now would only add bytes.
- **The editor type includes React's editor,** also for the editor without a user interface,
  which has no DOM: splitting Slate's one editor type would break hosts calling `ReactEditor`.
- **Action handlers return `true` to let the default happen,** as every plugin does.
- **`PluginInitFunction`,** for compatibility; the documentation recommends a return type.
- **`TextbitElement.isText`** (an element of class text), **`usePluginRegistry`**,
  `TBPluginRegistryAction`, and the other 2.x helpers.
- **Behaviour:** Tab leaves the editor; editors remove an exact copy of a block; an agent's
  changes are marked for 8 seconds; suggestions wait.

## Frozen, and documented as specifications

- the suggestions map `textbitSuggestions`, one entry per suggested block, and `hashNode`;
- the awareness field `textbitAgent`, with `changes` placed by Y.js relative positions;
- the agent's tool names, operations, error codes, result shapes and options, and the grammar
  of its line format (`FORMAT_GUIDE`'s wording and the tool descriptions may improve);
- the plugins' element types and properties, which every stored document holds;
- the `data-tb` hooks, the `tb-*` classes and the `--tb-*` tokens, including the four core reads
  with defaults of its own (`--tb-focus-ring-radius`, `--tb-nbsp-*`, `--tb-newline-*`).

## Versions

Core 3.0.0, with 1.0.0 of the plugins, the styles and the agent package: their APIs are settled
with it. See RELEASING.md.
