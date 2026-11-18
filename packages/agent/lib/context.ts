import type { Descendant } from 'slate'
import { getSchema, type DocumentSchema, type TBPluginDefinition } from '@dotvoid/textbit/headless'
import { createNames, type Names } from './names'
import { createHandles, type Handles } from './handles'

export interface AgentOptions {
  /** The editor's plugins, as given to Textbit.Root or createTextbitEditor */
  plugins?: TBPluginDefinition[]
  /** Offer reading only. Edits are refused. */
  readOnly?: boolean
  /**
   * What an agent may do with an element whose plugin is missing: move it
   * (default), or anything. People convert or remove such elements, not agents,
   * unless this is 'all'.
   */
  unknownElements?: 'move' | 'all'
  /** Characters a read returns at most before it pages. Default: 24000. */
  pageSize?: number
}

/** What every part of the agent shares */
export interface AgentContext {
  options: AgentOptions
  schema: DocumentSchema
  names: Names
  handles: (document: Descendant[]) => Handles
}

export function createContext(options: AgentOptions): AgentContext {
  const schema = getSchema(options.plugins)
  return {
    options,
    schema,
    names: createNames(schema),
    handles: createHandles
  }
}
