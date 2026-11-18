import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Textbit, useAgents } from '@dotvoid/textbit'
import { demoPlugins } from '../lib/plugins'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'

const URL = 'ws://localhost:1234'

/**
 * The lab's shared document, where an agent connected through MCP edits
 * alongside you. Start it with `npm run lab`; see apps/agent-lab.
 */
export const AgentLab = () => {
  const [joined, setJoined] = useState<string | null>(null)
  const [problem, setProblem] = useState('')
  const leave = useCallback(() => {
    setJoined(null)
    setProblem('The lab document was reset. Join again.')
  }, [])

  // The server names the current document: a copy kept from before a reset
  // must not be merged back into it
  const join = () => {
    setProblem('')
    fetch(`${URL.replace(/^ws/, 'http')}/lab`)
      .then((response) => response.json() as Promise<{ document: string }>)
      .then((body) => setJoined(body.document))
      .catch(() => setProblem(`No lab at ${URL}. Start it with npm run lab.`))
  }

  if (!joined) {
    return (
      <p className='demo-lab-join'>
        <button type='button' onClick={join}>Join the lab document</button>
        {' '}{problem || <>Needs <code>npm run lab</code> running.</>}
      </p>
    )
  }
  // A new document gets a new editor and Y.Doc
  return <LabEditor key={joined} name={joined} onGone={leave} />
}

const LabEditor = ({ name, onGone }: { name: string, onGone: () => void }) => {
  const plugins = useMemo(() => demoPlugins(), [])
  const [doc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)
  const [status, setStatus] = useState('connecting')

  // Made and destroyed in the effect, so React's development double run of
  // effects does not leave a destroyed provider behind
  useEffect(() => {
    const created = new HocuspocusProvider({
      url: URL,
      name,
      document: doc,
      token: 'lab',
      // The server turns away a document it no longer serves: after a reset
      onAuthenticationFailed: onGone
    })
    const onStatus = ({ status }: { status: string }) => setStatus(status)
    created.on('status', onStatus)
    setProvider(created)
    return () => {
      created.off('status', onStatus)
      created.destroy()
    }
  }, [doc, name, onGone])

  if (!provider) {
    return null
  }

  return (
    <div>
      <p className='demo-peer'>
        <span style={{ background: '#2f9e44' }} />
        You, {status === 'connected' ? 'in the lab document' : `${status} to ${URL}`}
      </p>
      <Textbit.Root
        value={doc.get('content', Y.XmlText)}
        awareness={provider.awareness}
        cursor={{ data: { name: 'You', color: '#2f9e44' } }}
        plugins={plugins}
      >
        <AgentStatus doc={doc} onUndo={() => doc.getMap('lab').set('undo', Date.now())} />
        <div className='demo-editor'>
          <Textbit.Gutter>
            <GutterMenu />
          </Textbit.Gutter>
          <Textbit.Editable contextMenu='always' aria-label='Lab document'>
            <SelectionToolbar />
            <EditorContextMenu />
          </Textbit.Editable>
        </div>
        <Textbit.Suggestions className='demo-lab-suggestions' aria-label='Suggestions from the agent' />
      </Textbit.Root>
    </div>
  )
}

/** What the agents in the document do, said for screen readers too, and undo */
const AgentStatus = ({ doc, onUndo }: { doc: Y.Doc, onUndo: () => void }) => {
  const agents = useAgents()
  // Whether the agent edits or suggests: shared, so the agent follows it
  const [suggest, setSuggest] = useState(() => doc.getMap('lab').get('review') === 'suggest')
  useEffect(() => {
    const map = doc.getMap('lab')
    const update = () => setSuggest(map.get('review') === 'suggest')
    map.observe(update)
    return () => map.unobserve(update)
  }, [doc])
  const said = agents.map((agent) => agent.status === 'idle' ? `${agent.name} is here` : `${agent.name} is working on the document`)

  return (
    <div className='demo-lab-status'>
      <span role='status'>{said.length ? said.join(', ') : 'No agent in the document'}</span>
      <label>
        <input type='checkbox' checked={suggest} onChange={(e) => doc.getMap('lab').set('review', e.target.checked ? 'suggest' : 'apply')} />
        {' '}The agent suggests
      </label>
      {agents.length > 0 && !suggest && <button type='button' onClick={onUndo}>Undo the agent’s last run</button>}
    </div>
  )
}
