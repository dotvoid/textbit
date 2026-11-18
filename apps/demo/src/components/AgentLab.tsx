import { useEffect, useMemo, useState } from 'react'
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
  const [joined, setJoined] = useState(false)

  if (!joined) {
    return (
      <p className='demo-lab-join'>
        <button type='button' onClick={() => setJoined(true)}>Join the lab document</button>
        {' '}Needs <code>npm run lab</code> running.
      </p>
    )
  }
  return <LabEditor />
}

const LabEditor = () => {
  const plugins = useMemo(() => demoPlugins(), [])
  const [doc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)
  const [status, setStatus] = useState('connecting')

  // Made and destroyed in the effect, so React's development double run of
  // effects does not leave a destroyed provider behind
  useEffect(() => {
    const created = new HocuspocusProvider({ url: URL, name: 'lab', document: doc })
    const onStatus = ({ status }: { status: string }) => setStatus(status)
    created.on('status', onStatus)
    setProvider(created)
    return () => {
      created.off('status', onStatus)
      created.destroy()
    }
  }, [doc])

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
        <AgentStatus onUndo={() => doc.getMap('lab').set('undo', Date.now())} />
        <div className='demo-editor'>
          <Textbit.Gutter>
            <GutterMenu />
          </Textbit.Gutter>
          <Textbit.Editable contextMenu='always' aria-label='Lab document'>
            <SelectionToolbar />
            <EditorContextMenu />
          </Textbit.Editable>
        </div>
      </Textbit.Root>
    </div>
  )
}

/** What the agents in the document do, said for screen readers too, and undo */
const AgentStatus = ({ onUndo }: { onUndo: () => void }) => {
  const agents = useAgents()
  const said = agents.map((agent) => agent.status === 'idle' ? `${agent.name} is here` : `${agent.name} is ${agent.status}`)

  return (
    <div className='demo-lab-status'>
      <span role='status'>{said.length ? said.join(', ') : 'No agent in the document'}</span>
      {agents.length > 0 && <button type='button' onClick={onUndo}>Undo the agent’s last run</button>}
    </div>
  )
}
