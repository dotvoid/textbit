import { useEffect, useState } from 'react'
import { LabEditor, labDocument } from '../components/LabEditor'
import './film.css'

/** What the film script drives on the page */
interface FilmControls {
  caption: (text: string) => void
  card: (title: string | null, subtitle?: string) => void
  log: (line: string, kind?: 'call' | 'result' | 'note') => void
  ready: boolean
}

declare global {
  interface Window {
    __film?: FilmControls
  }
}

/**
 * The demo movie's stage, at /?film: Alice and Bob in the lab document side by
 * side, what the agent calls, and captions and title cards. The film script in
 * apps/agent-lab drives it; nothing here is part of the editor.
 */
export const FilmPage = () => {
  const [name, setName] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [card, setCard] = useState<{ title: string, subtitle?: string } | null>(null)
  const [log, setLog] = useState<{ line: string, kind: string, at: number }[]>([])

  useEffect(() => {
    labDocument().then(setName).catch(() => setCaption('Start the lab: npm run lab'))
  }, [])

  useEffect(() => {
    window.__film = {
      caption: setCaption,
      card: (title, subtitle) => setCard(title ? { title, subtitle } : null),
      log: (line, kind = 'call') => setLog((previous) => [...previous.slice(-11), { line, kind, at: Date.now() }]),
      ready: !!name
    }
  }, [name])

  return (
    <div className='film'>
      <header className='film-header'>
        <strong>Textbit</strong> · one document, two people and an agent
      </header>
      <main className='film-stage'>
        {name && (
          <>
            <section className='film-person'>
              <LabEditor name={name} onGone={() => {}} person={{ name: 'Alice', color: '#d9480f' }} compact />
            </section>
            <section className='film-person'>
              <LabEditor name={name} onGone={() => {}} person={{ name: 'Bob', color: '#1971c2' }} compact />
            </section>
          </>
        )}
        <aside className='film-agent' aria-label='What the agent does'>
          <p className='film-agent-title'><span /> Writing assistant</p>
          <ol>
            {log.map((entry) => <li key={entry.at + entry.line} data-kind={entry.kind}>{entry.line}</li>)}
          </ol>
        </aside>
      </main>
      <div className='film-caption' data-shown={caption ? '' : undefined}>{caption}</div>
      {card && (
        <div className='film-card'>
          <h1>{card.title}</h1>
          {card.subtitle && <p>{card.subtitle}</p>}
        </div>
      )}
    </div>
  )
}
