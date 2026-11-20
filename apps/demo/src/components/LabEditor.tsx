import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from '@y/y'
import { createClient, type DocumentHandle } from '@dotvoid/y-quorum-client'
import { Textbit, useAgents } from '@dotvoid/textbit'
import { demoPlugins } from '../lib/plugins'
import { GutterMenu } from './GutterMenu'
import { SelectionToolbar } from './SelectionToolbar'
import { EditorContextMenu } from './EditorContextMenu'
import { CommentsPanel } from './CommentsPanel'
import { VersionsPanel } from './VersionsPanel'

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
  // A rebuilt content is another Y.Doc: the editor binds to the new one
  const [generation, setGeneration] = useState(0)
  const [composing, setComposing] = useState(false)
  // Who wrote what: the text shown through the server's attributions.
  // Otherwise the fork of the text, with what is suggested in it: typing goes
  // into the text, or with "I suggest", is suggested
  const [whoWrote, setWhoWrote] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const renderer = useMemo(
    () => (!handle ? undefined : whoWrote ? handle.attributionsRenderer() : handle.suggestionsRenderer()),
    // A rebuilt layer is bound again, through a renderer of its own
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whoWrote, handle, generation]
  )
  useEffect(() => {
    if (renderer instanceof Y.DiffRenderer) {
      renderer.suggestionMode = suggesting
    }
  }, [renderer, suggesting])
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
        // A rebuilt content or fork is another Y.Doc; rebuilt comments follow by themselves
        document.on('rebuilt', ({ layer }) => {
          if (layer !== 'comments') {
            setGeneration((n) => n + 1)
          }
        })
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

  const body = (whoWrote ? handle?.content : handle?.suggestionsDoc.get('content'))?.getAttr('body')
  if (!handle || !(body instanceof Y.Node)) {
    return null
  }

  return (
    <div>
      <p className='demo-peer'>
        <span style={{ background: person.color }} />
        {person.name}{compact ? '' : `, ${status === 'connected' ? 'in the lab document' : `${status} to ${LAB_URL}`}`}
      </p>
      {!compact && (
        <p className='demo-lab-who'>
          <label>
            <input type='checkbox' checked={suggesting} disabled={whoWrote} onChange={(e) => setSuggesting(e.target.checked)} /> I suggest
          </label>
          <label>
            <input type='checkbox' checked={whoWrote} onChange={(e) => setWhoWrote(e.target.checked)} /> Who wrote what
          </label>
        </p>
      )}
      {whoWrote && <WhoWrote handle={handle} />}
      <Textbit.Root
        key={`${generation}-${whoWrote}`}
        value={body}
        renderer={renderer}
        awareness={handle.awareness}
        cursor={{ data: { name: person.name, color: person.color } }}
        plugins={plugins}
        comments={handle.comments.field(['body'])}
        className={compact ? undefined : 'demo-commented'}
      >
        <div>
          <AgentStatus handle={handle} onUndo={() => handle.appendRecord('agent.undo', { at: Date.now() })} />
          <div className='demo-editor'>
            {!compact && (
              <Textbit.Gutter>
                <GutterMenu />
              </Textbit.Gutter>
            )}
            <Textbit.Editable contextMenu='always' aria-label={compact ? `${person.name}’s editor` : 'Lab document'}>
              <SelectionToolbar />
              <EditorContextMenu onComment={() => setComposing(true)} />
            </Textbit.Editable>
          </div>
          <Textbit.Suggestions className='demo-lab-suggestions' aria-label='Suggestions' people={handle.people} />
          {!compact && <VersionsPanel handle={handle} plugins={plugins} />}
        </div>
        {!compact && (
          // The lab's principal ids are people's names, in lower case
          <CommentsPanel composing={composing} onComposed={() => setComposing(false)} me={person.name.toLowerCase()} />
        )}
      </Textbit.Root>
    </div>
  )
}

const PALETTE = ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#f08c00', '#0c8599', '#c2255c', '#5c940d']

/** A colour for each person and agent in the attributions, and a legend */
const WhoWrote = ({ handle }: { handle: DocumentHandle }) => {
  const [people, setPeople] = useState(() => ({ ...handle.people }))
  useEffect(() => {
    const update = () => setPeople({ ...handle.people })
    handle.on('attributions', update)
    return () => handle.off('attributions', update)
  }, [handle])
  // In the order they first wrote: people are only ever added, so colours stay
  const keys = Object.keys(people)
  const colour = (key: string) => PALETTE[keys.indexOf(key) % PALETTE.length]

  return (
    <>
      <style>
        {keys.map((key) => `[data-tb-by="${CSS.escape(key)}"] { background: color-mix(in srgb, ${colour(key)} 22%, transparent); }`).join('\n')}
      </style>
      <p className='demo-lab-legend'>
        {keys.map((key) => (
          <span key={key}><i style={{ background: colour(key) }} />{people[key].name}{people[key].kind === 'agent' ? ' (agent)' : ''}</span>
        ))}
      </p>
    </>
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
