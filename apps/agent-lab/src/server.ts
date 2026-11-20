// The lab's document server: y-quorum on ws://localhost:1234, its state in a
// SQLite file in .lab/ beside this folder.
//
// One document, lab/article: the demo's article as its body, and the switch
// between the agent editing and suggesting as a field of its own. "Undo the
// agent's run" is a record people append and the agent acts on.
//
// Anyone may join with a name as token; a token starting with "agent:" joins
// as an agent. The rpc `history` gives the latest entries of the document's
// history, for the demo to list. `npm run lab:reset` removes the state: the next start makes a
// new document, with a new incarnation, and clients still holding the old one
// discard it rather than merge it in.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createServer, defineType, number, object, oneOf, sqlite, text, type QuorumServer
} from '@dotvoid/y-quorum'
import { document as article } from '../../demo/src/document.ts'
import { plugins } from './plugins.ts'

const PORT = Number(process.env.LAB_PORT ?? 1234)
const FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../.lab')
mkdirSync(FOLDER, { recursive: true })

export const labArticle = defineType('lab/article', {
  content: object({
    body: text({ plugins: 'demo' }),
    review: oneOf(['apply', 'suggest'], { optional: true }),
    created: number({ optional: true })
  }),
  records: { 'agent.undo': { description: 'Someone asked to undo the agent’s last run' } },
  comments: true,
  suggestions: true,
  history: true
})

const server = createServer({
  types: [labArticle],
  storage: sqlite(resolve(FOLDER, 'lab.sqlite')),
  authenticate: (token) => {
    const name = token.trim() || 'Someone'
    const agent = name.startsWith('agent:')
    const shown = agent ? name.slice('agent:'.length) || 'Agent' : name
    return {
      // The kind is the principal's own: ids are plain names
      principal: { kind: agent ? 'agent' : 'person', id: shown.toLowerCase(), name: shown },
      namespaces: ['lab']
    }
  },
  // Everyone in the lab owns the document: they may restore versions too
  authorize: () => ['owner'],
  // What the editors render: repairs and checks of the body go by them
  plugins: { demo: plugins },
  rpc: {
    history: async (_args, { server: quorum }) => latestHistory(quorum)
  }
})

/** One entry of the history as the demo lists it: who, as a name, and what */
export interface HistoryRow {
  seq: number
  at: number
  kind: string
  layer: string
  by: string
  onBehalfOf?: string
  run?: string
  model?: string
  /** The log positions it folds */
  from: number
  to: number
}

// The latest entries, newest first, with people by name rather than key
async function latestHistory(quorum: QuorumServer, count = 30): Promise<HistoryRow[]> {
  const lines = (await quorum.exportHistory('lab', 'article')).split('\n').filter(Boolean)
  const people = await quorum.people('lab', 'article')
  const name = (key: string) => people[key]?.name ?? key
  return lines.slice(-count).reverse().map((line) => {
    const entry = JSON.parse(line) as {
      seq: number, at: number, kind: string, layer: string, from: number, to: number
      actor: { by: string, onBehalfOf?: string, run?: string, model?: string }
    }
    const { actor } = entry
    return {
      seq: entry.seq,
      at: entry.at,
      kind: entry.kind,
      layer: entry.layer,
      from: entry.from,
      to: entry.to,
      by: name(actor.by),
      ...(actor.onBehalfOf ? { onBehalfOf: name(actor.onBehalfOf) } : {}),
      ...(actor.run ? { run: actor.run } : {}),
      ...(actor.model ? { model: actor.model } : {})
    }
  })
}

if (!(await server.read('lab', 'article'))) {
  await server.create('lab', 'article', 'lab/article', { body: article, review: 'apply', created: Date.now() })
}

await server.listen(PORT)
console.log(`Lab document server on ws://localhost:${PORT}, document lab/article, state in ${FOLDER}`)
