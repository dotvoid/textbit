// The lab's document server: y-quorum on ws://localhost:1234, its state in a
// SQLite file in .lab/ beside this folder.
//
// One document, lab/article: the demo's article as its body, and the switch
// between the agent editing and suggesting as a field of its own. "Undo the
// agent's run" is a record people append and the agent acts on.
//
// Anyone may join with a name as token; a token starting with "agent:" joins
// as an agent. `npm run lab:reset` removes the state: the next start makes a
// new document, with a new incarnation, and clients still holding the old one
// discard it rather than merge it in.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, defineType, number, object, oneOf, sqlite, text } from '@dotvoid/y-quorum'
import { document as article } from '../../demo/src/document.ts'

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
  }
})

if (!(await server.read('lab', 'article'))) {
  await server.create('lab', 'article', 'lab/article', { body: article, review: 'apply', created: Date.now() })
}

await server.listen(PORT)
console.log(`Lab document server on ws://localhost:${PORT}, document lab/article, state in ${FOLDER}`)
