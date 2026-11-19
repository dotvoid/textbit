import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from '@y/y'
import { createClient, type DocumentHandle } from '@dotvoid/y-quorum-client'
import { Textbit, useAgents } from '@dotvoid/textbit'
import { demoPlugins } from '../lib/plugins'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'

export const LAB_URL = 'ws://localhost:1234'

/**
 * One person in the lab document: their editor, what the agent does, the
 * switch between editing and suggesting, and the suggestions to review. Each
 * has a connection of their own, as they would in their own browsers.
 */
export const LabEditor = ({ onGone, person = { name: 'You', color: '#2f9e44' }, compact = false }: {
  onGone: (reason: string) => void
  person?: { name: string, color: string }
  /** Without gutter and status line: for showing several side by side */
  compact?: boolean
}) => {
  const plugins = useMemo(() => demoPlugins(), [])
  const [handle, setHandle] = useState<DocumentHandle | null>(null)
  const [status, setStatus] = useState('connecting')
  // A rebuilt document is another Y.Doc: the editor binds to the new one
  const [generation, setGeneration] = useState(0)
  // The latest callback, without making a new connection when it changes
  const gone = useRef(onGone)
  useEffect(() => {
    gone.current = onGone
  }, [onGone])

  // Made and closed in the effect, so React's development double run of
  // effects does not leave a closed client behind
  useEffect(() => {
    const client = createClient({ url: LAB_URL, token: person.name })
    let opened: DocumentHandle | undefined
    let cancelled = false
    const onStatus = (next: string) => setStatus(next)
    client.on('status', onStatus)
    client.ready
      .then(() => client.open('lab', 'article'))
      .then((document) => {
        if (cancelled) {
          document.release()
          return
        }
        opened = document
        document.on('closed', () => gone.current('The lab document was reset. Join again.'))
        document.on('rebuilt', () => setGeneration((n) => n + 1))
        setHandle(document)
      })
      .catch(() => {
        // A client closed by this effect's own cleanup is not a missing lab
        if (!cancelled) {
          gone.current(`No lab at ${LAB_URL}. Start it with npm run lab.`)
        }
      })
    return () => {
      cancelled = true
      client.off('status', onStatus)
      opened?.release()
      client.close()
    }
  }, [person.name])

  const body = handle?.content.getAttr('body')
  if (!handle || !(body instanceof Y.Node)) {
    return null
  }

  return (
    <div>
      <p className='demo-peer'>
        <span style={{ background: person.color }} />
        {person.name}{compact ? '' : `, ${status === 'connected' ? 'in the lab document' : `${status} to ${LAB_URL}`}`}
      </p>
      <Textbit.Root
        key={generation}
        value={body}
        awareness={handle.awareness}
        cursor={{ data: { name: person.name, color: person.color } }}
        plugins={plugins}
      >
        <AgentStatus handle={handle} onUndo={() => handle.appendRecord('agent.undo', { at: Date.now() })} />
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
const AgentStatus = ({ handle, onUndo }: { handle: DocumentHandle, onUndo: () => void }) => {
  const agents = useAgents()
  // Whether the agent edits or suggests: shared, so the agent follows it
  const [suggest, setSuggest] = useState(() => handle.content.getAttr('review') === 'suggest')
  useEffect(() => {
    const update = () => setSuggest(handle.content.getAttr('review') === 'suggest')
    handle.content.on('delta', update)
    return () => handle.content.off('delta', update)
  }, [handle])
  const said = agents.map((agent) => agent.status === 'idle' ? `${agent.name} is here` : `${agent.name} is working on the document`)

  return (
    <div className='demo-lab-status'>
      <span role='status'>{said.length ? said.join(', ') : 'No agent in the document'}</span>
      <label>
        <input type='checkbox' checked={suggest} onChange={(e) => handle.content.setAttr('review', e.target.checked ? 'suggest' : 'apply')} />
        {' '}The agent suggests
      </label>
      {agents.length > 0 && !suggest && <button type='button' onClick={onUndo}>Undo the agent’s last run</button>}
    </div>
  )
}
