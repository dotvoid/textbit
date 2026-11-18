import type { JsonSchema } from '@dotvoid/textbit/headless'
import type { DocumentAgent } from './agent'
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
      })
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
      })
    },
    {
      name: `${prefix}types`,
      description: 'The element types this document can hold, with their properties, children, marks and inline elements.',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ types: agent.describe() })
    }
  ]

  if (!agent.context.options.readOnly) {
    tools.push({
      name: `${prefix}edit`,
      description: [
        'Change the document: a batch of operations, applied together or not at all.',
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
      handler: (input) => agent.edit(input as unknown as Parameters<DocumentAgent['edit']>[0])
    })
  }

  return tools
}
