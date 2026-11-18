import type { TBJsonSchema as JsonSchema } from '@dotvoid/textbit/headless'
import type { DocumentAgent, ReadResult, SearchResult } from './agent'
import type { EditResult } from './edit'
import { FORMAT_GUIDE } from './describe'

/**
 * A tool for a model, in no framework's shape: a name, what it does, the JSON
 * Schema of its input and a handler. Adapt it to MCP, an in-page tool API or
 * your model SDK in a few lines.
 */
export interface AgentTool {
  name: string
  description: string
  inputSchema: JsonSchema
  handler: (input: Record<string, unknown>) => unknown
  /**
   * The handler's result as text for a model, the document's lines as they
   * are rather than escaped in JSON. For hosts that pass tool results as text,
   * as MCP and most model SDKs do.
   */
  toText: (result: unknown) => string
}

const PLACEMENT = {
  after: { type: 'string', description: 'Place it after this element, by handle' },
  before: { type: 'string', description: 'Place it before this element, by handle' },
  into: { type: 'string', description: 'Place it last inside this element, by handle' }
}

const OPERATION: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      description: 'Replace an element with content. One element in place of one keeps its handle.',
      properties: { op: { const: 'replace' }, id: { type: 'string' }, content: { type: 'string' } },
      required: ['op', 'id', 'content']
    },
    {
      type: 'object',
      description: 'Insert content. Without after, before or into: at the end of the document.',
      properties: { op: { const: 'insert' }, content: { type: 'string' }, ...PLACEMENT },
      required: ['op', 'content']
    },
    {
      type: 'object',
      description: 'Delete an element',
      properties: { op: { const: 'delete' }, id: { type: 'string' } },
      required: ['op', 'id']
    },
    {
      type: 'object',
      description: 'Move an element',
      properties: { op: { const: 'move' }, id: { type: 'string' }, ...PLACEMENT },
      required: ['op', 'id']
    },
    {
      type: 'object',
      description: 'Set or, with null, remove properties of an element',
      properties: {
        op: { const: 'setProperties' },
        id: { type: 'string' },
        properties: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean', 'null'] } }
      },
      required: ['op', 'id', 'properties']
    },
    {
      type: 'object',
      description: 'Replace text within an element, its marks kept. find must occur once, unless all is true.',
      properties: {
        op: { const: 'replaceText' },
        id: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
        all: { type: 'boolean' }
      },
      required: ['op', 'id', 'find', 'replace']
    }
  ]
}

/**
 * The tools for an agent: reading, searching and the element types, and,
 * unless the agent is read-only, editing. Names start with `prefix`, by
 * default `document_`.
 */
export function createAgentTools(agent: DocumentAgent, options: { prefix?: string } = {}): AgentTool[] {
  const prefix = options.prefix ?? 'document_'
  const tools: AgentTool[] = [
    {
      name: `${prefix}read`,
      description: `Read the document, or a page of it, with its revision.\n\n${FORMAT_GUIDE}`,
      inputSchema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Start at this top-level element, by handle; the next of a previous read' },
          limit: { type: 'integer', minimum: 1, description: 'Top-level elements to return at most' }
        }
      },
      handler: (input) => agent.read({
        ...(typeof input.from === 'string' ? { from: input.from } : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {})
      }),
      toText: (result) => {
        const { revision, total, next, view, suggestions } = result as ReadResult
        const waiting = suggestions ? `\n${suggestions} suggestion${suggestions === 1 ? '' : 's'} waiting for review; the document does not include them` : ''
        return `revision: ${revision}\n${total} top-level elements${next ? `; more from ${next}` : ''}${waiting}\n\n${view}`
      }
    },
    {
      name: `${prefix}search`,
      description: 'Find text in the document, case ignored. Returns each text element containing it as its line, with the top-level element it is in.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1 }
        },
        required: ['query']
      },
      handler: (input) => agent.search({
        query: String(input.query ?? ''),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {})
      }),
      toText: (result) => {
        const { revision, matches } = result as SearchResult
        return [
          `revision: ${revision}`,
          matches.length ? `${matches.length} found` : 'Not found',
          '',
          ...matches.map((match) => match.in ? `${match.line}    (in #${match.in})` : match.line)
        ].join('\n')
      }
    },
    {
      name: `${prefix}types`,
      description: 'The element types this document can hold, with their properties, children, marks and inline elements.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ types: agent.describe() }),
      toText: (result) => (result as { types: string }).types
    }
  ]

  if (!agent.context.options.readOnly) {
    tools.push({
      name: `${prefix}edit`,
      description: [
        agent.context.options.review === 'suggest'
          ? 'Suggest changes to the document: a batch of operations, checked together. Nothing changes: the people in the document see your suggestion and accept or reject it, block by block. Moving a block cannot be suggested.'
          : 'Change the document: a batch of operations, applied together or not at all.',
        'Pass the revision of the read you planned from: if someone changed the elements you change since, nothing is applied and you get their current content. Changes elsewhere do not matter.',
        'On success you get the new revision and the changed top-level elements, new handles included.',
        'Content is written in the line format of read, without handles.'
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          operations: { type: 'array', minItems: 1, items: OPERATION },
          revision: { type: 'string', description: 'The revision of the read or search the changes are based on' },
          opId: { type: 'string', description: 'An id for this batch; sent again, it is not applied again' }
        },
        required: ['operations']
      },
      handler: (input) => agent.edit(input as unknown as Parameters<DocumentAgent['edit']>[0]),
      toText: (result) => editText(result as EditResult)
    })
  }

  return tools
}

function editText(result: EditResult): string {
  if (result.ok && result.suggestion) {
    return `Suggested, for a person to accept or reject; the document has not changed. suggestion: ${result.suggestion}\n\nThe blocks as suggested:\n${result.view}`
  }
  if (result.ok) {
    return `Done. revision: ${result.revision}\n\n${result.view}`
  }
  const { error } = result
  return [
    `Nothing was changed. ${error.code}${error.operation !== undefined ? ` in operation ${error.operation}` : ''}: ${error.message}`,
    ...error.hint ? [error.hint] : [],
    ...(error.issues ?? []).map((issue) => `- ${issue.code}${issue.element ? ` at #${issue.element.slice(0, 8)}` : ''}: ${issue.message}`),
    `revision: ${result.revision}`,
    ...result.view ? ['', result.view] : []
  ].join('\n')
}
