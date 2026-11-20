// @dotvoid/y-quorum/mcp: agents at a y-quorum server, through the Model
// Context Protocol. A module the host mounts: it supplies who is calling and
// which documents they may find; the module supplies the tools.
//
// The module is a y-quorum client like any other, never a way around the
// server: it works as the person the agent acts for, every change claimed as
// the agent's, so the server's rules, history and accountability apply as they
// do to everyone.
import * as Y from '@y/y'
import { McpServer, createMcpHandler, fromJsonSchema, type CallToolResult, type JsonSchemaType, type JsonSchemaValidator, type jsonSchemaValidator } from '@modelcontextprotocol/server'
import { Element, Node, type Editor } from 'slate'
import { createTextbitEditor, sharedOf, suggestedChanges, type TBPluginDefinition } from '@dotvoid/textbit/headless'
import { createAgentPresence, createAgentTools, createDocumentAgent, type AgentPresence, type AgentTool, type DocumentAgent } from '@dotvoid/textbit-agent'
import { createClient, type Client, type DocumentHandle } from '@dotvoid/y-quorum-client'
import { resolvePath, toJSON, type Field, type ObjectField, type TypeDefinition } from '@dotvoid/y-quorum-client/model'
import type { ActorClaim } from '@dotvoid/y-quorum-client/protocol'

/** What an agent may do in a document, beyond what the person may: the host's say */
export type AgentPolicy = 'none' | 'read' | 'comment' | 'suggest' | 'edit'

/** Who is calling: the agent, and the person it works for */
export interface McpCaller {
  /** Same caller, same connection: e.g. the person's and the agent's ids */
  key: string
  /** The person's token for the y-quorum server: the agent works as them */
  token: string
  /** The agent, as it is recorded with every change it makes */
  agent: { id: string, name: string, model?: string }
}

/** A document the caller may find */
export interface FoundDocument {
  namespace: string
  id: string
  type?: string
  title?: string
}

/** What `createMcpModule` takes */
export interface McpModuleOptions {
  /** The y-quorum server's WebSocket address */
  url: string
  /** The document types, as the server has them */
  types: TypeDefinition[]
  /** Plugin definitions by the name a text field gives in `text({ plugins })`; `default` for none */
  plugins: Record<string, TBPluginDefinition[]>
  /** Who an HTTP request is from, or nothing to refuse it */
  identify(request: Request): Promise<McpCaller | null> | McpCaller | null
  /** Finds documents for the caller: the host's index */
  documents?(caller: McpCaller, query: { namespace?: string, text?: string, cursor?: string }): Promise<{ documents: FoundDocument[], next?: string }>
  /** What agents may do in a document. Default: whatever the person may. */
  agentPolicy?(document: { namespace: string, id: string, type: string, content: Record<string, unknown> }): AgentPolicy
  /** Milliseconds an unused connection stays open. Default: 60000. */
  idle?: number
  /** For Node before 22, or tests */
  WebSocket?: typeof WebSocket
}

/** The mounted module */
export interface McpModule {
  /** Serves one MCP request over HTTP: mount it at a path, e.g. `/mcp` */
  fetch(request: Request): Promise<Response>
  close(): Promise<void>
}

const RANKS: AgentPolicy[] = ['none', 'read', 'comment', 'suggest', 'edit']
const rank = (policy: AgentPolicy) => RANKS.indexOf(policy)

/** One text field, as an agent works on it */
interface OpenField {
  editor: Editor
  fork?: Editor
  agent: DocumentAgent
  tools: Map<string, AgentTool>
}

interface OpenDocument {
  handle: DocumentHandle
  origin: object
  claim: ActorClaim
  presence: AgentPresence
  fields: Map<string, OpenField>
}

interface Session {
  client: Client
  documents: Map<string, Promise<OpenDocument>>
  timer?: ReturnType<typeof setTimeout>
}

export function createMcpModule(options: McpModuleOptions): McpModule {
  const types = new Map(options.types.map((type) => [type.name, type]))
  const sessions = new Map<string, Session>()
  // Callers by key: the HTTP handler passes the key through as the token it validated
  const callers = new Map<string, McpCaller>()

  // ---- Connections, one per caller, closed when unused --------------------

  function sessionOf(caller: McpCaller): Session {
    let session = sessions.get(caller.key)
    if (!session) {
      session = {
        client: createClient({ url: options.url, token: caller.token, ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}) }),
        documents: new Map()
      }
      sessions.set(caller.key, session)
    }
    clearTimeout(session.timer)
    const kept = session
    session.timer = setTimeout(() => close(caller.key, kept), options.idle ?? 60000)
    session.timer.unref?.()
    return session
  }

  function close(key: string, session: Session) {
    if (sessions.get(key) === session) {
      sessions.delete(key)
      callers.delete(key)
    }
    for (const opening of session.documents.values()) {
      void opening.then((document) => {
        document.presence.clear()
        document.handle.release()
      }, () => undefined)
    }
    session.client.close()
  }

  async function documentOf(caller: McpCaller, doc: string): Promise<OpenDocument> {
    const session = sessionOf(caller)
    let opening = session.documents.get(doc)
    if (!opening) {
      opening = open(session, caller, doc)
      session.documents.set(doc, opening)
      opening.catch(() => session.documents.delete(doc))
    }
    return opening
  }

  async function open(session: Session, caller: McpCaller, doc: string): Promise<OpenDocument> {
    const [namespace, ...rest] = doc.split('/')
    const id = rest.join('/')
    if (!namespace || !id) {
      throw new ToolError('invalid', `A document is named namespace/id, e.g. news/article-1; not ${doc}`)
    }
    await session.client.ready
    const handle = await session.client.open(namespace, id)
    const claim: ActorClaim = { agent: caller.agent.id, name: caller.agent.name, ...(caller.agent.model ? { model: caller.agent.model } : {}) }
    const presence = createAgentPresence(handle.awareness, { name: caller.agent.name })
    presence.set('idle')
    // A document rebuilt after a refusal is another: work on the new one
    handle.on('rebuilt', () => session.documents.delete(doc))
    return { handle, origin: handle.claimOrigin(claim), claim, presence, fields: new Map() }
  }

  // ---- What the agent may do there ----------------------------------------

  function policyOf(document: OpenDocument): AgentPolicy {
    const { handle } = document
    const type = types.get(handle.type)
    const granted = options.agentPolicy && type
      ? options.agentPolicy({ namespace: handle.namespace, id: handle.id, type: handle.type, content: toJSON(handle.content, type.content) })
      : 'edit'
    // Never more than the person may
    const capabilities = handle.capabilities
    const person: AgentPolicy = capabilities.write ? 'edit'
      : capabilities.suggestions && capabilities.suggestions !== 'none' ? 'suggest'
        : capabilities.comments && capabilities.comments !== 'none' ? 'comment'
          : capabilities.read ? 'read' : 'none'
    return rank(granted) < rank(person) ? granted : person
  }

  // Comments are a layer of their own: a type may have none, and a person may
  // be allowed to edit yet not to comment
  function requireComments(document: OpenDocument) {
    require(document, 'comment')
    if ((document.handle.capabilities.comments ?? 'none') === 'none') {
      throw new ToolError('not-allowed', 'There are no comments to write in this document')
    }
  }

  function require(document: OpenDocument, needed: AgentPolicy) {
    const allowed = policyOf(document)
    if (rank(allowed) < rank(needed)) {
      const hint = needed === 'edit' && allowed === 'suggest' ? '; suggest instead, with document_suggest' : ''
      throw new ToolError('not-allowed', `Agents may ${allowed === 'none' ? 'do nothing' : `only ${allowed}`} in this document${hint}`)
    }
  }

  // ---- Text fields ----------------------------------------------------------

  function textFields(schema: ObjectField, prefix: string[] = []): string[][] {
    return Object.entries(schema.fields).flatMap(([key, field]: [string, Field]) =>
      field.kind === 'text' ? [[...prefix, key]] : field.kind === 'object' ? textFields(field, [...prefix, key]) : [])
  }

  function fieldOf(document: OpenDocument, name: string | undefined): OpenField {
    const { handle } = document
    const type = types.get(handle.type)
    if (!type) {
      throw new ToolError('invalid', `This server's MCP module does not know the type ${handle.type}`)
    }
    const path = name ? name.split('.') : textFields(type.content)[0]
    if (!path) {
      throw new ToolError('invalid', 'This document has no text field')
    }
    const key = path.join('.')
    const known = document.fields.get(key)
    if (known) {
      return known
    }
    const resolved = resolvePath(handle.content, type.content, path)
    const forkResolved = resolvePath(handle.suggestionsDoc.get('content'), type.content, path)
    if (!resolved || resolved.field.kind !== 'text' || !(resolved.value instanceof Y.Node)) {
      const names = textFields(type.content).map((p) => p.join('.')).join(', ')
      throw new ToolError('invalid', `No text field ${key}; the text fields are ${names}`)
    }
    const plugins = options.plugins[resolved.field.plugins ?? 'default'] ?? options.plugins.default ?? []
    const editor = createTextbitEditor({ plugins, shared: resolved.value })
    const fork = forkResolved?.value instanceof Y.Node ? createTextbitEditor({ plugins, shared: forkResolved.value }) : undefined
    const agent = createDocumentAgent(editor, {
      plugins, presence: document.presence, origin: document.origin, ...(fork ? { suggestIn: fork } : {})
    })
    const opened: OpenField = { editor, ...(fork ? { fork } : {}), agent, tools: new Map(createAgentTools(agent).map((tool) => [tool.name, tool])) }
    document.fields.set(key, opened)
    return opened
  }

  // ---- The tools --------------------------------------------------------------

  type Handler = (caller: McpCaller, input: Record<string, unknown>) => Promise<string>

  const docInput = {
    doc: { type: 'string', description: 'The document, as namespace/id' },
    field: { type: 'string', description: 'The text field, e.g. body or meta.summary; default: the first' }
  }

  // The agent package's tools for one field, behind a document and a field
  function fieldTool(name: string, needs: AgentPolicy, review?: 'apply' | 'suggest'): Handler {
    return async (caller, input) => {
      const document = await documentOf(caller, String(input.doc ?? ''))
      require(document, needs)
      const field = fieldOf(document, typeof input.field === 'string' ? input.field : undefined)
      if (review === 'suggest' && !field.fork) {
        throw new ToolError('not-allowed', 'This document takes no suggestions')
      }
      if (review) {
        field.agent.context.options.review = review
      }
      const tool = field.tools.get(name)!
      const rest = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'doc' && key !== 'field'))
      const result = tool.handler(rest)
      if (typeof result === 'object' && result !== null && 'ok' in result && result.ok === false) {
        throw new ToolError('refused', tool.toText(result))
      }
      return tool.toText(result)
    }
  }

  const tools: Array<{ name: string, description: string, input: Record<string, unknown>, required: string[], readOnly: boolean, handler: Handler }> = [
    {
      name: 'documents_list',
      description: 'Find documents you may work on. Each is named namespace/id, the `doc` the other tools take.',
      input: { namespace: { type: 'string' }, text: { type: 'string', description: 'Words to look for' }, cursor: { type: 'string' } },
      required: [],
      readOnly: true,
      handler: async (caller, input) => {
        if (!options.documents) {
          return 'This server lists no documents: ask the person which one to work on.'
        }
        const found = await options.documents(caller, {
          ...(typeof input.namespace === 'string' ? { namespace: input.namespace } : {}),
          ...(typeof input.text === 'string' ? { text: input.text } : {}),
          ...(typeof input.cursor === 'string' ? { cursor: input.cursor } : {})
        })
        const lines = found.documents.map((d) => `${d.namespace}/${d.id}${d.type ? ` (${d.type})` : ''}${d.title ? `: ${d.title}` : ''}`)
        return [...lines, ...(found.next ? [`next: ${found.next}`] : [])].join('\n') || 'No documents found.'
      }
    },
    {
      name: 'document_fields',
      description: 'The document as JSON: its plain fields, lists, and text fields as textbit elements; and what you may do in it.',
      input: { doc: docInput.doc },
      required: ['doc'],
      readOnly: true,
      handler: async (caller, input) => {
        const document = await documentOf(caller, String(input.doc ?? ''))
        require(document, 'read')
        const type = types.get(document.handle.type)
        const content = type ? toJSON(document.handle.content, type.content) : {}
        const textFieldNames = type ? textFields(type.content).map((p) => p.join('.')) : []
        return JSON.stringify({ type: document.handle.type, agents: policyOf(document), textFields: textFieldNames, content }, null, 2)
      }
    },
    {
      name: 'document_set_field',
      description: 'Set a plain field (not a text field) of the document, by its dot path, e.g. status or meta.slug.',
      input: { doc: docInput.doc, path: { type: 'string' }, value: { description: 'The new value: a string, number or boolean' } },
      required: ['doc', 'path', 'value'],
      readOnly: false,
      handler: async (caller, input) => {
        const document = await documentOf(caller, String(input.doc ?? ''))
        require(document, 'edit')
        const type = types.get(document.handle.type)!
        const path = String(input.path ?? '').split('.')
        const key = path.pop()!
        const parent = resolvePath(document.handle.content, type.content, path)
        const field = parent?.field.kind === 'object' ? parent.field.fields[key] : undefined
        if (!parent || !(parent.value instanceof Y.Node) || !field || field.kind === 'text' || field.kind === 'object' || field.kind === 'list') {
          throw new ToolError('invalid', `No plain field ${input.path}`)
        }
        if (field.kind === 'oneOf' && !field.values?.includes(String(input.value))) {
          throw new ToolError('invalid', `${input.path} is one of ${field.values?.join(', ')}`)
        }
        const node = parent.value
        document.handle.doc.transact(() => node.setAttr(key, input.value), document.origin)
        return `Set ${input.path}.`
      }
    },
    { name: 'document_read', description: 'Read a text field of the document, one element per line, with handles for editing.', input: { ...docInput, from: { type: 'string' }, limit: { type: 'number' } }, required: ['doc'], readOnly: true, handler: fieldTool('document_read', 'read') },
    { name: 'document_search', description: 'Find text in a text field of the document.', input: { ...docInput, query: { type: 'string' } }, required: ['doc', 'query'], readOnly: true, handler: fieldTool('document_search', 'read') },
    { name: 'document_types', description: 'The element types a text field takes, with their properties.', input: { ...docInput }, required: ['doc'], readOnly: true, handler: fieldTool('document_types', 'read') },
    {
      name: 'document_edit',
      description: 'Change a text field: a batch of operations, applied together or not at all, against the revision of your read.',
      input: { ...docInput, revision: { type: 'string' }, operations: { type: 'array', items: { type: 'object' } } },
      required: ['doc', 'revision', 'operations'],
      readOnly: false,
      handler: fieldTool('document_edit', 'edit', 'apply')
    },
    {
      name: 'document_suggest',
      description: 'Suggest changes to a text field, as document_edit takes them: nothing changes until a person accepts.',
      input: { ...docInput, revision: { type: 'string' }, operations: { type: 'array', items: { type: 'object' } } },
      required: ['doc', 'revision', 'operations'],
      readOnly: false,
      handler: fieldTool('document_edit', 'suggest', 'suggest')
    },
    {
      name: 'suggestions_list',
      description: 'The suggestions waiting in a text field: what each would change, and who suggested it.',
      input: { ...docInput },
      required: ['doc'],
      readOnly: true,
      handler: async (caller, input) => {
        const document = await documentOf(caller, String(input.doc ?? ''))
        require(document, 'read')
        const field = fieldOf(document, typeof input.field === 'string' ? input.field : undefined)
        if (!field.fork) {
          return 'This document takes no suggestions.'
        }
        const forkField = sharedOf(field.fork)?.field
        if (!forkField) {
          return 'No suggestions.'
        }
        // A view of the fork through the difference, made for this answer and let go after
        const renderer = document.handle.suggestionsRenderer()
        const view = createTextbitEditor({ shared: forkField, renderer })
        try {
          const changes = suggestedChanges(view)
          return changes.length
            ? JSON.stringify(changes.map(({ kind, inserted, deleted, by }) => ({ kind, inserted, deleted, by })), null, 2)
            : 'No suggestions.'
        } finally {
          sharedOf(view)?.release()
          renderer.destroy()
        }
      }
    },
    {
      name: 'comments_list',
      description: 'The comment threads of the document: what is commented on, by whom, and the replies.',
      input: { doc: docInput.doc },
      required: ['doc'],
      readOnly: true,
      handler: async (caller, input) => {
        const document = await documentOf(caller, String(input.doc ?? ''))
        require(document, 'read')
        const threads = document.handle.comments.threads.map((thread) => ({
          id: thread.id,
          field: thread.anchor.path.join('.'),
          quote: thread.anchor.quote,
          resolved: Boolean(thread.resolved),
          comments: thread.comments.filter((c) => !c.deleted).map((c) => ({ by: c.author.name, body: c.body }))
        }))
        return threads.length ? JSON.stringify(threads, null, 2) : 'No comments.'
      }
    },
    {
      name: 'comment_create',
      description: 'Comment on some text: quote it exactly as it stands in the field.',
      input: { ...docInput, quote: { type: 'string' }, body: { type: 'string' } },
      required: ['doc', 'quote', 'body'],
      readOnly: false,
      handler: async (caller, input) => {
        const document = await documentOf(caller, String(input.doc ?? ''))
        requireComments(document)
        const name = typeof input.field === 'string' ? input.field : undefined
        const field = fieldOf(document, name)
        const quote = String(input.quote ?? '')
        const found = locate(field.editor, quote)
        if (!found) {
          throw new ToolError('invalid', `The quote is not in the text: ${quote}`)
        }
        const type = types.get(document.handle.type)!
        const path = name ? name.split('.') : textFields(type.content)[0]
        const id = document.handle.comments.create({ path, quote, block: found.block, offset: found.offset }, String(input.body ?? ''), document.claim)
        return `Commented, thread ${id}.`
      }
    },
    {
      name: 'comment_reply',
      description: 'Reply in a comment thread.',
      input: { doc: docInput.doc, thread: { type: 'string' }, body: { type: 'string' } },
      required: ['doc', 'thread', 'body'],
      readOnly: false,
      handler: async (caller, input) => {
        const document = await documentOf(caller, String(input.doc ?? ''))
        requireComments(document)
        document.handle.comments.reply(String(input.thread ?? ''), String(input.body ?? ''), document.claim)
        return 'Replied.'
      }
    }
  ]

  // ---- Serving ----------------------------------------------------------------

  // Tools check their own input and say what is wrong in terms a model can act on
  const passThrough: jsonSchemaValidator = {
    getValidator<T>(): JsonSchemaValidator<T> {
      return (input) => ({ valid: true, data: input as T, errorMessage: undefined })
    }
  }

  const handler = createMcpHandler((context) => {
    const caller = context.authInfo ? callers.get(context.authInfo.token) : undefined
    const server = new McpServer(
      { name: 'y-quorum', version: '1.0.0' },
      {
        capabilities: { tools: {} },
        instructions: 'Documents people write together, live. Read before you change anything, pass the revision of your read, make small changes, and suggest rather than edit where you are asked to. Name documents as namespace/id.'
      }
    )
    for (const tool of tools) {
      server.registerTool(tool.name, {
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>({ type: 'object', properties: tool.input, required: tool.required } as JsonSchemaType, passThrough),
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false }
      }, async (input: unknown): Promise<CallToolResult> => {
        if (!caller) {
          return { isError: true, content: [{ type: 'text', text: 'Not signed in' }] }
        }
        try {
          const text = await tool.handler(caller, isRecord(input) ? input : {})
          return { content: [{ type: 'text', text }] }
        } catch (error) {
          const message = error instanceof ToolError ? `${error.code}: ${error.message}` : String(error)
          return { isError: true, content: [{ type: 'text', text: message }] }
        }
      })
    }
    return server
  })

  return {
    fetch: async (request) => {
      const caller = await options.identify(request)
      if (!caller) {
        return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } })
      }
      callers.set(caller.key, caller)
      return handler.fetch(request, { authInfo: { token: caller.key, clientId: caller.agent.id, scopes: [] } })
    },
    close: async () => {
      for (const [key, session] of sessions) {
        close(key, session)
      }
      await handler.close()
    }
  }
}

/** A refusal a model can act on: a code and what to do */
class ToolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

// Where a quote is: the element holding it, and where in its text
function locate(editor: Editor, quote: string): { block: string, offset: number } | undefined {
  for (const [node] of Node.descendants(editor)) {
    if (Element.isElement(node) && typeof node.id === 'string' && node.children.some((child) => !Element.isElement(child))) {
      const offset = Node.string(node).indexOf(quote)
      if (offset >= 0) {
        return { block: node.id, offset }
      }
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
