// An MCP server, over stdio, giving an agent the textbit-agent tools on the
// lab's shared document. The MCP client starts it, e.g.
//
//   claude mcp add textbit-lab -- node /path/to/textbit/apps/agent-lab/src/mcp.ts
//
// It joins the lab's y-quorum server (npm run lab) as an agent of its own, so
// everything it writes is the agent's, with a presence the editors show.
// stdout is the MCP channel: everything else goes to stderr.
import {
  McpServer,
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
  type JsonSchemaValidator,
  type RegisteredTool,
  type jsonSchemaValidator
} from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as Y from '@y/y'
import { createClient } from '@dotvoid/y-quorum-client'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import {
  createAgentPresence,
  createAgentTools,
  createDocumentAgent,
  type AgentRun,
  type AgentTool
} from '@dotvoid/textbit-agent'
import { plugins } from './plugins.ts'

const URL = process.env.LAB_URL ?? 'ws://localhost:1234'
const NAME = process.env.LAB_AGENT_NAME ?? 'Agent'
const COLOR = process.env.LAB_AGENT_COLOR ?? '#7c3aed'
// A run ends after this long without a tool call: the agent is done with the task
const RUN_IDLE_MS = Number(process.env.LAB_RUN_IDLE_MS ?? 20000)

const log = (...args: unknown[]) => console.error('[textbit-lab]', ...args)

const client = createClient({ url: URL, token: `agent:${NAME}` })
const handle = await Promise.race([
  client.ready.then(() => client.open('lab', 'article')),
  new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`No document server at ${URL}. Start it with: npm run lab`)), 8000))
]).catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
// Working on a document that was reset, or a copy the server refused, would be
// working on nothing: the MCP client starts the server again on reconnect
handle.on('closed', () => {
  log('the lab document is gone; reconnect the MCP server to join the new one')
  process.exit(1)
})
// Its comments rebuilt are followed by themselves, and the awareness stays;
// the content and its fork are bound here
handle.on('rebuilt', ({ layer }) => {
  if (layer !== 'comments') {
    log('the server refused a change and the document was rebuilt; reconnect the MCP server')
    process.exit(1)
  }
})
log(`joined lab/article at ${URL}`)

const body = handle.content.getAttr('body')
if (!(body instanceof Y.Node)) {
  log('The lab document has no body')
  process.exit(1)
}
const editor = createTextbitEditor({ plugins, shared: body })
// The fork of the text, where the agent suggests: what it changes there is a suggestion
const forkBody = handle.suggestionsDoc.get('content').getAttr('body')
if (!(forkBody instanceof Y.Node)) {
  log('The lab document has no suggestions')
  process.exit(1)
}
const forkEditor = createTextbitEditor({ plugins, shared: forkBody })

const presence = createAgentPresence(handle.awareness, { name: NAME, color: COLOR })
presence.set('idle')
// Edit, or suggest for people to accept or reject: the demo's switch, a field
// of the document, else LAB_REVIEW
const review = () => (handle.content.getAttr('review') ?? process.env.LAB_REVIEW ?? 'apply') === 'suggest' ? 'suggest' : 'apply'
const agent = createDocumentAgent(editor, { plugins, presence, review: review(), suggestIn: forkEditor })
let tools = createAgentTools(agent)

// Runs: the first tool call starts one, a pause ends it
let run: AgentRun | undefined
let lastRun: AgentRun | undefined
let idle: ReturnType<typeof setTimeout> | undefined
function touchRun() {
  if (!run) {
    run = agent.startRun()
    log('run started')
  }
  clearTimeout(idle)
  idle = setTimeout(() => {
    run?.finish()
    log(`run finished, ${run?.edits} edits`)
    lastRun = run
    run = undefined
  }, RUN_IDLE_MS)
}

// The switch between editing and suggesting
let reviewSeen = review()
handle.content.on('delta', () => {
  if (review() !== reviewSeen) {
    reviewSeen = review()
    agent.context.options.review = review()
    tools = createAgentTools(agent)
    registerTools()
    log(`the agent now ${review() === 'suggest' ? 'suggests' : 'edits'}`)
  }
})

// The demo's "Undo the agent's run" button appends a record
let recordsSeen = handle.records.length
handle.on('records', () => {
  const fresh = handle.records.slice(recordsSeen)
  recordsSeen = handle.records.length
  if (!fresh.some((record) => record.kind === 'agent.undo')) {
    return
  }
  const target = run ?? lastRun
  if (run) {
    run.finish()
    clearTimeout(idle)
    run = undefined
  }
  const result = target?.undo() ?? { ok: false, message: 'No run to undo' }
  log('undo', JSON.stringify(result))
  lastRun = undefined
})

// The tools check their own input and explain what is wrong in terms the model
// can act on, so the SDK passes input through rather than refusing it first
const passThrough: jsonSchemaValidator = {
  getValidator<T>(): JsonSchemaValidator<T> {
    return (input) => ({ valid: true, data: input as T, errorMessage: undefined })
  }
}

function call(tool: AgentTool, input: Record<string, unknown>): CallToolResult {
  touchRun()
  try {
    const result = tool.handler(input)
    const failed = typeof result === 'object' && result !== null && 'ok' in result && result.ok === false
    log(tool.name, failed ? 'failed' : 'ok')
    return { isError: failed, content: [{ type: 'text', text: tool.toText(result) }] }
  } catch (error) {
    log(tool.name, 'threw', error)
    return { isError: true, content: [{ type: 'text', text: String(error) }] }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

let server: McpServer | undefined
const registered = new Map<string, RegisteredTool>()

// Registers the current tools, or updates those the review mode changed; the
// SDK tells the client the list changed
function registerTools() {
  if (!server) {
    return
  }
  for (const [name, entry] of registered) {
    if (!tools.some((tool) => tool.name === name)) {
      entry.remove()
      registered.delete(name)
    }
  }
  for (const tool of tools) {
    const existing = registered.get(tool.name)
    if (existing) {
      if (existing.description !== tool.description) {
        existing.update({ description: tool.description })
      }
      continue
    }
    // Calls the tool as it is now: the review mode replaces the descriptors
    const callback = (input: unknown) => {
      const current = tools.find((t) => t.name === tool.name) ?? tool
      return call(current, isRecord(input) ? input : {})
    }
    registered.set(tool.name, server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType, passThrough)
    }, callback))
  }
}

serveStdio(() => {
  server = new McpServer(
    { name: 'textbit-lab', version: '0.0.0' },
    {
      capabilities: { tools: { listChanged: true } },
      instructions: `A shared document people are editing at the same time, in a browser. Read it first, plan small, targeted edits, pass the revision of your read, and keep to what you were asked. Use ${tools.map((t) => t.name).join(', ')}.`
    }
  )
  registered.clear()
  registerTools()
  return server
})
log('MCP server ready')

const quit = () => {
  presence.clear()
  handle.release()
  client.close()
  process.exit(0)
}
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
process.stdin.on('close', quit)
