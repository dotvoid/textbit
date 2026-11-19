export type {
  SpellingError as TBSpellingError,
  Decoration as TBDecoration,
  PluginDefinition as TBPluginDefinition,
  TextbitEditor as TBEditor,
  TextbitElement as TBElement,
  TextbitText as TBText,
  TextbitRange as TBRange,
  PluginInitFunction as TBPluginInitFunction,
  Resource as TBResource,
  Plugin as TBPlugin,
  PluginView as TBPluginView,
  ComponentView as TBComponentView,
  ElementSpec as TBElementSpec,
  ChildElementSpec as TBChildElementSpec,
  ElementClass as TBElementClass,
  ActionEvent as TBActionEvent,
  LeafStyle as TBLeafStyle,
  ElementSchema as TBElementSchema,
  PropertySchema as TBPropertySchema,
  GetLeafStyle as TBGetLeafStyle,
  ElementDefinition as TBElementDefinition,
  LeafDefinition as TBLeafDefinition,
  TopLevelConstraints as TBTopLevelConstraints,
  ChildConstraints as TBChildConstraints,
  Component as TBComponent,
  ComponentProps as TBComponentProps,
  ElementAttributes as TBElementAttributes,
  OwnElementComponent as TBOwnElementComponent,
  OwnElementComponentProps as TBOwnElementComponentProps,
  ToolComponent as TBToolComponent,
  ToolComponentProps as TBToolComponentProps,
  ActionHandlerArgs as TBActionHandlerArgs,
  ActionHandler as TBActionHandler,
  Action as TBAction,
  ConsumeFunction as TBConsumeFunction,
  ConsumesFunction as TBConsumesFunction,
  Options as TBPluginOptions
} from './types'

export type { PluginRegistryAction as TBPluginRegistryAction } from './contexts/PluginRegistry/lib/types'

// Import the types file to ensure declaration merging happens
import './types'

// Inject hard coded styles
import './utils/injectStyles'

import { TextbitRoot } from './components/TextbitRoot'
import { TextbitEditable } from './components/TextbitEditable/TextbitEditable'
import { Gutter as Gutter$1 } from './components/GutterProvider'
import { DropMarker } from './components/DropMarker'
import { UploadMarker } from './components/UploadMarker'
import { StandardPlugins } from './plugins'
import { ContextTools } from './components/ContextTools'
import { ContentTools } from './components/ContentTools'
import { ContextMenu } from './components/ContextMenu/'
import { SpecialCharacterPicker } from './components/SpecialCharacters/Picker'
import { Suggestions } from './components/Suggestions'

/**
 * The editor's components. Each is also exported on its own (`Root`,
 * `Editable`, …), which lets a bundler leave out the ones a host does not use.
 *
 * ```tsx
 * <Textbit.Root plugins={plugins} value={value} onChange={setValue}>
 *   <Textbit.Editable aria-label='Article' />
 * </Textbit.Root>
 * ```
 */
export const Textbit = {
  /** The editor: its document, plugins and options. Everything else goes inside it. */
  Root: TextbitRoot,
  /** Where the document is edited */
  Editable: TextbitEditable,
  /** A column beside the blocks, for a menu per block; see `Menu` */
  Gutter: Gutter$1.Content,
  /** Shows where a dragged block or file would go */
  DropMarker,
  /** Shows where an upload in progress will appear */
  UploadMarker,
  /** Core's plain paragraph plugin, to keep alongside plugins of your own */
  Plugins: StandardPlugins,
  /** A right-click menu with spelling suggestions and actions */
  ContextMenu,
  /** A searchable picker of special characters; needs the `SpecialCharacters` plugin */
  SpecialCharacterPicker,
  /** The suggestions in the document as an accessible list, with Accept and Reject */
  Suggestions
}

/**
 * A menu of actions, e.g. in the gutter: a button that opens a list of the
 * plugins' actions, keyboard accessible.
 *
 * ```tsx
 * <Menu.Root>
 *   <Menu.Trigger>+</Menu.Trigger>
 *   <Menu.Content>
 *     <Menu.Group>
 *       <Menu.Item action='base/text/set-heading-1'>
 *         <Menu.Icon /><Menu.Label>Heading</Menu.Label><Menu.Hotkey />
 *       </Menu.Item>
 *     </Menu.Group>
 *   </Menu.Content>
 * </Menu.Root>
 * ```
 */
export const Menu = {
  /** The menu */
  Root: ContentTools.Menu,
  /** The button that opens it */
  Trigger: ContentTools.Trigger,
  /** The list of items */
  Content: ContentTools.Content,
  /** A group of items */
  Group: ContentTools.Group,
  /** An action, by its registry name, e.g. `base/text/set-heading-1`; shown when the action says it is visible */
  Item: ContentTools.Item,
  /** The action's tool, as its icon */
  Icon: ContentTools.Icon,
  /** The action's name */
  Label: ContentTools.Label,
  /** The action's shortcut, written for the platform */
  Hotkey: ContentTools.Hotkey
}

/**
 * A formatting toolbar over the selection, keyboard accessible: Alt+F10
 * reaches it, arrow keys move in it.
 *
 * ```tsx
 * const { actions } = usePluginRegistry()
 *
 * <Toolbar.Root>
 *   <Toolbar.Group>
 *     {actions
 *       .filter((action) => action.plugin.class === 'leaf')
 *       .map((action) => <Toolbar.Item key={action.name} action={action} />)}
 *   </Toolbar.Group>
 * </Toolbar.Root>
 * ```
 */
export const Toolbar = {
  /** The toolbar, shown while text is selected */
  Root: ContextTools.Menu,
  /** A group of items */
  Group: ContextTools.Group,
  /** An action's tool: takes the action itself, from `usePluginRegistry().actions` */
  Item: ContextTools.Item
}

// Direct name exports
export { TextbitRoot as Root }
export { TextbitEditable as Editable }
export { DropMarker }
export { UploadMarker }
export { StandardPlugins as Plugins }
/** The same as `Textbit.Gutter` */
export const Gutter = Gutter$1.Content
export { ContextMenu }
export { SpecialCharacterPicker }
export { Suggestions }

// Opt-in plugins. Kept out of the Textbit object so hosts that never use them
// do not keep their data.
export {
  SpecialCharacters,
  type SpecialCharactersOptions as TBSpecialCharactersOptions
} from './components/SpecialCharacters'

// Built in, exported to change or remove its key
export { FocusToolbar, type FocusToolbarOptions as TBFocusToolbarOptions } from './plugins/FocusToolbar'

// The type of a plain text block, which core creates on Enter, paste and more
export { TEXT_TYPE } from './utils/textType'

export type {
  TextbitLabels as TBLabels,
  TextbitState as TBTextbitState,
  TextbitStats as TBStats,
  PlaceholdersVisibility as TBPlaceholdersVisibility
} from './contexts/TextbitContext'

// Props of the components
export type {
  TextbitRootProps as TBRootProps,
  TextbitRootBaseProps as TBRootBaseProps,
  TextbitRootStringProps as TBRootStringProps,
  TextbitRootDefaultProps as TBRootDefaultProps,
  TextbitRootYjsProps as TBRootYjsProps,
  TextbitRootCollaborationProps as TBRootCollaborationProps
} from './components/TextbitRoot'
export type { TextbitEditableProps as TBEditableProps } from './components/TextbitEditable/TextbitEditable'
export type { ContextMenuMode as TBContextMenuMode } from './hooks/useContextMenu'
export type { UploadMarkerProps as TBUploadMarkerProps } from './components/UploadMarker'

// What the hooks give
export type {
  PluginRegistryProviderState as TBPluginRegistry,
  PluginRegistryComponent as TBPluginRegistryComponent
} from './contexts/PluginRegistry/lib/types'
export type { BlockSelectionState as TBBlockSelectionState } from './contexts/BlockSelectionContext'
export type { SelectionBounds as TBSelectionBounds } from './contexts/SelectionBoundsContext'
export type {
  ContextMenuHints as TBContextMenuHints,
  ContextMenuSpellingHints as TBContextMenuSpellingHints
} from './components/ContextMenu/ContextMenuHintsContext'
export type { SuggestionsValue as TBSuggestions } from './contexts/SuggestionsContext'
export type { AgentChangesValue as TBAgentChanges } from './contexts/AgentChangesContext'
export type {
  PendingDropsContextValue as TBPendingDrops,
  PendingDropsController as TBPendingDropsController
} from './contexts/PendingDropsContext'
export type { OnSpellcheckCallback as TBOnSpellcheck } from './with/withSpeling'

// The interfaces of the helper objects
export type { TextbitEditorInterface as TBEditorHelpers } from './utils/textbit-editor'
export type { TextbitElementInterface as TBElementHelpers } from './utils/textbit-element'
export type { TextbitPluginInterface as TBPluginHelpers } from './utils/textbit-plugin'

// Hooks
export { useAction } from './hooks/useAction'
export { usePluginRegistry } from './hooks/usePluginRegistry'
export { useTextbit } from './hooks/useTextbit'
export { useContextMenuHints } from './components/ContextMenu/useContextMenuHints'
export { useSelectionBounds } from './hooks/useSelectionBounds'
export { useEditor } from './hooks/useEditor'
export { useBlockSelection } from './hooks/useBlockSelection'
export { useSelectionStats, type SelectionStats as TBSelectionStats } from './hooks/useSelectionStats'
export { usePendingDrops } from './hooks/usePendingDrops'
export { useAgents } from './hooks/useAgents'
export { useAgentChanges } from './hooks/useAgentChanges'
export { useSuggestions } from './hooks/useSuggestions'
export type { ShownSuggestion as TBShownSuggestion } from './contexts/SuggestionsContext'
export type { ResolvedAgentChange as TBShownAgentChange } from './utils/agentChanges'
export type { PresentAgent as TBPresentAgent } from './contexts/AgentPresenceContext'
export { AGENT_PRESENCE_FIELD, type AgentPresenceState as TBAgentPresence, type AgentStatus as TBAgentStatus, type AgentChange as TBAgentChange } from './types/agentPresence'
export { PendingDropsContext, type PendingDrop as TBPendingDrop } from './contexts/PendingDropsContext'

export {
  pipeFromDrop as consumeFileDropEvent,
  pipeFromFileInput as consumeFileInputChangeEvent
} from './utils/pipes'

// An editor without a user interface, to read, change or check documents
export { createTextbitEditor, type TextbitEditorOptions as TBEditorOptions } from './editor/createTextbitEditor'

// Shared documents: text fields of Y.js 14 documents
export {
  bindField,
  sharedOf,
  fieldToValue,
  seedField,
  SUGGESTED_MARK,
  pointToRelativePosition,
  relativePositionToPoint,
  rangeToRelativePositions,
  relativePositionsToRange,
  withSharedCursor,
  remoteCursors,
  type TBBindOptions,
  type TBSharedField,
  type TBRenderer,
  type TBCursorOptions,
  type TBRemoteCursor
} from './yjs'
export { getSchema, type DocumentSchema as TBDocumentSchema, type ElementTypeSchema as TBElementTypeSchema } from './schema/getSchema'
export { validate, type ValidationIssue as TBValidationIssue, type ValidationCode as TBValidationCode } from './schema/validate'
export { toJsonSchema, type JsonSchema as TBJsonSchema } from './schema/toJsonSchema'

// Suggestions: changes proposed for a person to accept or reject
export {
  suggestionStore,
  SUGGESTIONS_MAP,
  suggestionFor,
  suggestedBlockState,
  suggestedTextChanges,
  acceptSuggestedBlock,
  rejectSuggestedBlock,
  acceptSuggestion,
  rejectSuggestion,
  type Suggestion as TBSuggestion,
  type SuggestedBlock as TBSuggestedBlock,
  type SuggestionStore as TBSuggestionStore,
  type ReviewResult as TBReviewResult
} from './suggestions'
export { hashNode } from './utils/hashNode'
export { diffWords, type TextChange as TBTextChange } from './utils/diffWords'

export { calculateStats } from './utils/calculateStats'
export { TextbitEditor } from './utils/textbit-editor'
export { TextbitElement } from './utils/textbit-element'
export { TextbitPlugin } from './utils/textbit-plugin'
export { isMac } from './utils/modifier'

// Re-export slate types to ensure correct overloaded types are exported
export type {
  BaseEditor,
  BaseElement,
  BaseText,
  BaseRange,
  Descendant,
  Ancestor
} from 'slate'

// Re-export overloaded slate types to ensure correct overloaded types
export {
  Element,
  Text,
  Editor,
  Range,
  Node,
  Transforms
} from 'slate'
