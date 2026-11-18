/*
 * @dotvoid/textbit/headless: textbit without a user interface. Documents,
 * plugin definitions and the editor's rules, without React or a browser, to
 * use on a server, in a script or in an agent's tools.
 *
 * Nothing imported from here, directly or indirectly, may load React; a test
 * walks the imports to keep it so.
 */

export { createTextbitEditor, type TextbitEditorOptions } from './editor/createTextbitEditor'
export { TEXT_TYPE } from './utils/textType'
export { TextbitEditor } from './utils/textbit-editor'
export { TextbitElement } from './utils/textbit-element'
export { TextbitPlugin } from './utils/textbit-plugin'
export { Text } from './plugins/Text'
export { getSchema, type DocumentSchema, type ElementTypeSchema } from './schema/getSchema'
export { validate, type ValidationIssue, type ValidationCode } from './schema/validate'
export { toJsonSchema, type JsonSchema } from './schema/toJsonSchema'

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
