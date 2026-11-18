// Tools for agents to read and edit textbit documents. Nothing here needs
// React or a browser: it works on a live editor and on a headless one alike.
export { createDocumentAgent, type DocumentAgent, type ReadInput, type ReadResult, type SearchInput, type SearchResult, type EditInput } from './agent'
export { createAgentTools, type AgentTool } from './tools'
export type { AgentOptions } from './context'
export type { EditOperation, EditResult, EditError, EditErrorCode, Placement } from './edit'
export { FORMAT_GUIDE, describeSchema } from './describe'
export { createAgentPresence, type AgentPresence, type AwarenessLike } from './presence'
export type { AgentRun } from './runs'
