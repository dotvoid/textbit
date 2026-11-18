// An MCP server, over stdio, giving an agent the textbit-agent tools on the
// shared document "lab". The MCP client starts it, e.g.
//
//   claude mcp add textbit-lab -- node /path/to/textbit/apps/agent-lab/src/mcp.ts
//
// It joins the document server (npm run lab) as a peer of its own, like a
// person's browser, with a presence the editors show. stdout is the MCP
// channel: everything else goes to stderr.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { YjsEditor } from '@slate-yjs/core'
import type { Editor } from 'slate'
import { createTextbitEditor } from '@dotvoid/textbit/headless'
import { createAgentPresence, createAgentTools, createDocumentAgent, type AgentRun } from '@dotvoid/textbit-agent'
import { plugins } from './plugins.ts'

const URL = process.env.LAB_URL ?? 'ws://localhost:1234'
const NAME = process.env.LAB_AGENT_NAME ?? 'Agent'
const COLOR = process.env.LAB_AGENT_COLOR ?? '#7c3aed'
// A run ends after this long without a tool call: the agent is done with the task
const RUN_IDLE_MS = Number(process.env.LAB_RUN_IDLE_MS ?? 20000)

const log = (...args: unknown[]) => console.error('[textbit-lab]', ...args)

// The current incarnation of the lab document, see server.ts
const documentName = await fetch(URL.replace(/^ws/, 'http') + '/lab')
  .then((response) => response.json() as Promise<{ document: string }>)
  .then((body) => body.document)
  .catch(() => {
    log(`No document server at ${URL}. Start it with: npm run lab`)
    process.exit(1)
  })

const ydoc = new Y.Doc()
const provider = new HocuspocusProvider({
  url: URL,
  name: documentName,
  document: ydoc,
  token: 'lab',
  // After a reset the document is another: working on the old copy would be
  // working on nothing. The MCP client starts the server again on reconnect.
  onAuthenticationFailed: () => {
    log(`${documentName} was reset; reconnect the MCP server to join the new document`)
    process.exit(1)
  }
})
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`No document server at ${URL}. Start it with: npm run lab`)), 8000)
  provider.on('synced', () => {
    clearTimeout(timeout)
    resolve()
  })
})
log(`joined ${documentName} at ${URL}`)

const editor = createTextbitEditor({ plugins, shared: ydoc.get('content', Y.XmlText) })
YjsEditor.connect(editor as YjsEditor & Editor)

const presence = createAgentPresence(provider.awareness!, { name: NAME, color: COLOR })
presence.set('idle')
// Edit, or suggest for people to accept or reject: the demo's switch, shared
// through the document, else LAB_REVIEW
const review = () => (ydoc.getMap('lab').get('review') ?? process.env.LAB_REVIEW ?? 'apply') === 'suggest' ? 'suggest' : 'apply'
const agent = createDocumentAgent(editor, { plugins, presence, review: review() })
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

// The demo's "Undo the agent's run" button asks through the document
const commands = ydoc.getMap('lab')
commands.observe((event) => {
  if (event.keysChanged.has('review')) {
    agent.context.options.review = review()
    tools = createAgentTools(agent)
    log(`the agent now ${review() === 'suggest' ? 'suggests' : 'edits'}`)
    server.sendToolListChanged().catch(() => {})
  }
  if (!event.keysChanged.has('undo') || event.transaction.local) {
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

const server = new Server(
  { name: 'textbit-lab', version: '0.0.0' },
  {
    capabilities: { tools: { listChanged: true } },
    instructions: `A shared document people are editing at the same time, in a browser. Read it first, plan small, targeted edits, pass the revision of your read, and keep to what you were asked. Use ${tools.map((t) => t.name).join(', ')}.`
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as { type: 'object' }
  }))
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = tools.find((t) => t.name === request.params.name)
  if (!tool) {
    return { isError: true, content: [{ type: 'text' as const, text: `No tool ${request.params.name}` }] }
  }
  touchRun()
  try {
    const result = tool.handler(request.params.arguments ?? {})
    const failed = typeof result === 'object' && result !== null && 'ok' in result && result.ok === false
    log(request.params.name, failed ? 'failed' : 'ok')
    return { isError: failed, content: [{ type: 'text' as const, text: tool.toText(result) }] }
  } catch (error) {
    log(request.params.name, 'threw', error)
    return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }
  }
})

await server.connect(new StdioServerTransport())
log('MCP server ready')

const quit = () => {
  presence.clear()
  provider.destroy()
  process.exit(0)
}
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
process.stdin.on('close', quit)
