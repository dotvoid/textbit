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

// Main library composed exports
export const Textbit = {
  Root: TextbitRoot,
  Editable: TextbitEditable,
  Gutter: Gutter$1.Content,
  DropMarker,
  UploadMarker,
  Plugins: StandardPlugins,
  ContextMenu,
  SpecialCharacterPicker,
  Suggestions
}

export const Menu = {
  Root: ContentTools.Menu,
  Trigger: ContentTools.Trigger,
  Content: ContentTools.Content,
  Group: ContentTools.Group,
  Item: ContentTools.Item,
  Icon: ContentTools.Icon,
  Label: ContentTools.Label,
  Hotkey: ContentTools.Hotkey
}

export const Toolbar = {
  Root: ContextTools.Menu,
  Group: ContextTools.Group,
  Item: ContextTools.Item
}

// Direct name exports
export { TextbitRoot as Root }
export { TextbitEditable as Editable }
export { DropMarker }
export { UploadMarker }
export { StandardPlugins as Plugins }
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

export type { TextbitLabels as TBLabels } from './contexts/TextbitContext'

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
