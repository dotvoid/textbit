import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Textbit, useAgents } from '@dotvoid/textbit'
import { demoPlugins } from '../lib/plugins'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'

export const LAB_URL = 'ws://localhost:1234'

/** The name of the lab's current document, from its server */
export async function labDocument(): Promise<string> {
  const response = await fetch(`${LAB_URL.replace(/^ws/, 'http')}/lab`)
  return (await response.json() as { document: string }).document
}

/**
 * One person in the lab document: their editor, what the agent does, the
 * switch between editing and suggesting, and the suggestions to review
 */
export const LabEditor = ({ name, onGone, person = { name: 'You', color: '#2f9e44' }, compact = false }: {
  name: string
  onGone: () => void
  person?: { name: string, color: string }
  /** Without gutter and status line: for showing several side by side */
  compact?: boolean
}) => {
  const plugins = useMemo(() => demoPlugins(), [])
  const [doc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null)
  const [status, setStatus] = useState('connecting')
  // The latest callback, without making a new connection when it changes
  const gone = useRef(onGone)
  useEffect(() => {
    gone.current = onGone
  }, [onGone])

  // Made and destroyed in the effect, so React's development double run of
  // effects does not leave a destroyed provider behind
  useEffect(() => {
    const created = new HocuspocusProvider({
      url: LAB_URL,
      name,
      document: doc,
      token: 'lab',
      // The server turns away a document it no longer serves: after a reset
      onAuthenticationFailed: () => gone.current()
    })
    const onStatus = ({ status }: { status: string }) => setStatus(status)
    created.on('status', onStatus)
    setProvider(created)
    return () => {
      created.off('status', onStatus)
      created.destroy()
    }
  }, [doc, name])

  if (!provider) {
    return null
  }

  return (
    <div>
      <p className='demo-peer'>
        <span style={{ background: person.color }} />
        {person.name}{compact ? '' : `, ${status === 'connected' ? 'in the lab document' : `${status} to ${LAB_URL}`}`}
      </p>
      <Textbit.Root
        value={doc.get('content', Y.XmlText)}
        awareness={provider.awareness}
        cursor={{ data: { name: person.name, color: person.color } }}
        plugins={plugins}
      >
        <AgentStatus doc={doc} onUndo={() => doc.getMap('lab').set('undo', Date.now())} />
        <div className='demo-editor'>
          {!compact && (
            <Textbit.Gutter>
              <GutterMenu />
            </Textbit.Gutter>
          )}
          <Textbit.Editable contextMenu='always' aria-label={compact ? `${person.name}’s editor` : 'Lab document'}>
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
