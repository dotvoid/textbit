/*
 * @dotvoid/textbit/headless: textbit without a user interface. Documents,
 * plugin definitions and the editor's rules, without React or a browser, to
 * use on a server, in a script or in an agent's tools.
 *
 * Nothing imported from here, directly or indirectly, may load React; a test
 * walks the imports to keep it so.
 */

export { createTextbitEditor, type TextbitEditorOptions as TBEditorOptions } from './editor/createTextbitEditor'
export type { OnSpellcheckCallback as TBOnSpellcheck } from './with/withSpeling'
export type { TextbitEditorInterface as TBEditorHelpers } from './utils/textbit-editor'
export type { TextbitElementInterface as TBElementHelpers } from './utils/textbit-element'
export type { TextbitPluginInterface as TBPluginHelpers } from './utils/textbit-plugin'
export { TEXT_TYPE } from './utils/textType'
export { TextbitEditor } from './utils/textbit-editor'
export { TextbitElement } from './utils/textbit-element'
export { TextbitPlugin } from './utils/textbit-plugin'
export { Text } from './plugins/Text'
export { diffWords, type TextChange as TBTextChange } from './utils/diffWords'
export { AGENT_PRESENCE_FIELD, type AgentPresenceState as TBAgentPresence, type AgentStatus as TBAgentStatus, type AgentChange as TBAgentChange } from './types/agentPresence'
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

export type {
  PluginDefinition as TBPluginDefinition,
  ElementDefinition as TBElementDefinition,
  LeafDefinition as TBLeafDefinition,
  ElementSpec as TBElementSpec,
  ChildElementSpec as TBChildElementSpec,
  ElementClass as TBElementClass,
  TopLevelConstraints as TBTopLevelConstraints,
  ChildConstraints as TBChildConstraints,
  Action as TBAction,
  ActionEvent as TBActionEvent,
  ActionHandler as TBActionHandler,
  ActionHandlerArgs as TBActionHandlerArgs,
  Resource as TBResource,
  ConsumeFunction as TBConsumeFunction,
  ConsumesFunction as TBConsumesFunction,
  GetLeafStyle as TBGetLeafStyle,
  LeafStyle as TBLeafStyle,
  Options as TBPluginOptions,
  ElementSchema as TBElementSchema,
  PropertySchema as TBPropertySchema
} from './types/definition'
export type {
  TextbitEditor as TBEditor,
  TextbitElement as TBElement,
  TextbitText as TBText,
  TextbitRange as TBRange
} from './types/slate'
