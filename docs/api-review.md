# API review for 3.0

Everything public in 3.0, and what to do with it before it is frozen. After 3.0 only additions
are allowed, so anything here we would not want to keep forever has to change now.

Each point has a number. **Decide** marks a choice for you; the rest are proposals that go
ahead unless you say otherwise. Answer with the numbers, e.g. "3 yes, 7 keep as is".

Public means four things: the code (exports, names, types, options, defaults, result
shapes), what is stored in documents, what is sent between peers or shown to models, and the
hooks stylesheets target.

## A. Naming

**1. One naming rule. Decide.** Today core mixes prefixed and plain names: most types are
`TB…` (`TBPlugin`, `TBElementSpec`), but newer ones are not (`DocumentSchema`,
`ValidationIssue`, `Suggestion`, `AgentPresenceState`, `TextbitEditorOptions`,
`SelectionStats`, `PendingDrop`, `TextChange`), and one type and one value share a name
(`TBEditor` is the editor type, `TextbitEditor` the helper functions).

- **Proposal:** every type exported by `@dotvoid/textbit` and its headless entry is `TB…`;
  values (functions, components, constants) are plain. The prefix keeps them apart from
  Slate's `Element`, `Text` and `Editor`, which hosts import too. Renames:

  | Now | 3.0 |
  |---|---|
  | `TextbitEditorOptions` | `TBEditorOptions` |
  | `DocumentSchema`, `ElementTypeSchema` | `TBDocumentSchema`, `TBElementTypeSchema` |
  | `ValidationIssue`, `ValidationCode` | `TBValidationIssue`, `TBValidationCode` |
  | `JsonSchema` | `TBJsonSchema` |
  | `Suggestion`, `SuggestedBlock`, `SuggestionStore`, `ReviewResult` | `TBSuggestion`, `TBSuggestedBlock`, `TBSuggestionStore`, `TBReviewResult` |
  | `AgentPresenceState`, `AgentStatus`, `AgentChange` | `TBAgentPresence`, `TBAgentStatus`, `TBAgentChange` |
  | `TBAgentChange` (a change as an editor shows it) | `TBShownAgentChange`, like `TBShownSuggestion` |
  | `PresentAgent` | `TBPresentAgent` |
  | `SelectionStats`, `PendingDrop`, `TextChange` | `TBSelectionStats`, `TBPendingDrop`, `TBTextChange` |

- **Alternative:** drop the prefix everywhere and let hosts alias on import. Cleaner names,
  but a rename of every type for every 2.x host, and clashes with Slate's names.
- The agent package keeps its plain names: they are its own and already specific
  (`DocumentAgent`, `AgentTool`, `EditOperation`).

**2. One way to import components.** Each component is exported twice: in the `Textbit`
object (`Textbit.Root`) and on its own (`Root`), likewise `Editable`, `Gutter`, `DropMarker`,
`UploadMarker`, `ContextMenu`, `SpecialCharacterPicker`. Proposal: keep the namespaces
(`Textbit.*`, `Menu.*`, `Toolbar.*`), as the documentation uses them, and remove the bare
duplicates.

## B. Remove before 3.0

**3. `Textbit.Plugins` / `Plugins`** (core's plain paragraph plugin). Core adds it by itself
when a host gives no plugins; exporting it invites registering it twice. Remove.

**4. Slate re-exports.** Core re-exports Slate's `Element`, `Text`, `Editor`, `Range`, `Node`,
`Transforms` and some of its types. That ties textbit's API to Slate's: a Slate change becomes
a textbit change. Hosts have Slate installed anyway (it is a peer). Proposal: remove; hosts
import from `slate`. **Decide**, as 2.x hosts may use them.

**5. `ActionHandlerArgs.api`.** An untyped bag, marked "FIXME" in the code, used for one
thing: letting a menu action open the file picker and hand the files to the consumers (Image,
Audio). Proposal: replace it with one typed field, `consumeFiles?: (files: File[]) => void`.

## C. Fix before 3.0

**6. `describeSchema(schema, names)`** in the agent package needs a `names` object nothing
exports: as it stands it cannot be called. Proposal: `describeSchema(schema)`.

**7. Version the stored and sent formats.** Add `version: 1` to each suggestion entry in the
Y.Doc and to the agent presence state. Later releases can then read 3.0 documents and peers
knowingly. Cheap now, impossible to add cleanly later.

**8. Specify the formats** in the documentation, as part of the API:
- suggestions: the `textbitSuggestions` map, one entry per suggested block, its fields, and
  `hashNode` (canonical JSON, FNV-1a), which every peer must compute alike;
- presence: the `textbitAgent` awareness field, including `changes` with Y.js relative
  positions;
- the agent's line format, its tool names and operations, as models see them;
- the plugins' element types and properties (`base/image` with `src`, and so on): they are in
  every stored document.

## D. Keep, and document as they are

**9. The editor type `TBEditor`** includes React's editor (`ReactEditor`), also for the editor
`createTextbitEditor` makes, which has no DOM. Changing it would split Slate's one editor type
in two and break hosts that call `ReactEditor` functions. Proposal: keep; document that the
headless editor has no DOM methods.

**10. Action handlers return `true` to let the default happen** (e.g. let the key through).
Unusual, but it is how every plugin works. Keep and document.

**11. `PluginInitFunction`.** Keep for compatibility; the documentation recommends writing
`(options): TBPlugin => ({ … })`, which TypeScript checks properly.

**12. `TextbitElement.isText`** means "an element of class text", not a Slate text node. Keep
(2.x name) and document clearly.

**13. `usePluginRegistry` and `TBPluginRegistryAction`** show the registry's inner shape. Keep:
hosts build menus from it. Document the fields hosts may rely on (`plugins`, `actions`), and
mark the rest as not for use.

**14. Helpers kept from 2.x:** `TextbitEditor.*`, `TextbitElement.*`, `TextbitPlugin.*`,
`calculateStats`, `isMac`, `consumeFileDropEvent`, `consumeFileInputChangeEvent`,
`PendingDropsContext`, `useContextMenuHints`, `useSelectionBounds`. Keep and document each.

**15. Defaults that are behaviour:** Tab leaves the editor; editors remove an exact copy of a
block; an agent's changes are marked for 8 seconds (`agentChangeDuration`); suggestions wait.
Document as behaviour.

## E. The agent package

**16. Version. Decide.** `1.0.0` puts it under the same promise as core: no breaking changes
without a major. `0.1.0` keeps it free to change, which semver allows below 1.0, but then the
promise does not cover the part that makes 3.0 what it is. Proposal: `1.0.0`.

**17. Freeze:** the tool names (`document_read`, `document_search`, `document_types`,
`document_edit`, and the `prefix` option), the operations (`replace`, `insert`, `delete`,
`move`, `setProperties`, `replaceText`), the error codes, the result shapes, the options
(`plugins`, `readOnly`, `unknownElements`, `pageSize`, `presence`, `review`, `author`), and
the grammar of the line format. `FORMAT_GUIDE`'s wording and the tool descriptions are for
models and may improve; that is not a break.

**18. `AgentTool.toText`** is new since the package was written: keep, it is what MCP hosts use.

## F. The plugins package

**19. Keep:** every plugin, its options and labels, `imageNode`, `audioNode`, the
`definitions` entry. **Decide** its version: it is `0.1.1`; 3.0 changes its shape (definition
and view). Proposal: `1.0.0` alongside core, for the same reason as 16. The alternative is
`0.2.0`.

## G. Styles

**20. Freeze** the `data-tb` hooks (43 of them, from `editor` to `suggestion-reject`), the
classes (`tb-*`), and the `--tb-*` tokens. Four tokens are read by core but defined nowhere
(`--tb-focus-ring-radius`, `--tb-nbsp-*`, `--tb-newline-*`): document them as tokens with
their defaults.

## After the decisions

The changes above are small: renames, the removals, `consumeFiles`, `describeSchema`, the
format versions. They come with doc comments on every export, which TypeDoc then turns into
the reference for dotvoid.com, beside the guides.
