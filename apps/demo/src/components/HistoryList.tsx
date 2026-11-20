import { useEffect, useState } from 'react'
import type { DocumentHandle } from '@dotvoid/y-quorum-client'

/** One entry of the lab document's history, as the lab server's `history` call gives it */
export interface HistoryRow {
  seq: number
  at: number
  kind: string
  layer: string
  by: string
  onBehalfOf?: string
  run?: string
  model?: string
  from: number
  to: number
}

const KINDS: Record<string, string> = {
  edit: 'wrote',
  accept: 'accepted a suggestion',
  reject: 'rejected a suggestion',
  restore: 'restored a version',
  repair: 'repaired',
  review: 'reviewed',
  record: 'recorded',
  signature: 'signed'
}

/**
 * The latest entries of the document's history: who did what, and for whom.
 * Asked for again a moment after anyone writes.
 */
export const HistoryList = ({ handle, load }: {
  handle: DocumentHandle
  load: () => Promise<HistoryRow[]>
}) => {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        load().then((found) => {
          if (current) {
            setRows(found)
            setProblem('')
          }
        }, (error: Error) => {
          if (current) {
            setProblem(error.message)
          }
        })
      }, 300)
    }
    update()
    handle.on('attributions', update)
    handle.on('records', update)
    handle.on('versions', update)
    return () => {
      current = false
      clearTimeout(timer)
      handle.off('attributions', update)
      handle.off('records', update)
      handle.off('versions', update)
    }
  }, [handle, load])

  return (
    <section className='demo-history' aria-label='History'>
      <h3>History</h3>
      {problem && <p role='alert'>{problem}</p>}
      <ol>
        {rows.map((row) => (
          <li key={row.seq}>
            <time dateTime={new Date(row.at).toISOString()}>{new Date(row.at).toLocaleTimeString()}</time>
            <span>
              <strong>{row.by}</strong>
              {row.onBehalfOf && ` for ${row.onBehalfOf}`}
              {` ${KINDS[row.kind] ?? row.kind}`}
              {row.layer !== 'content' && ` in ${row.layer}`}
            </span>
            <small>
              {row.from === row.to ? `change ${row.from}` : `changes ${row.from}–${row.to}`}
              {row.run && `, run ${row.run.slice(0, 8)}`}
            </small>
          </li>
        ))}
      </ol>
    </section>
  )
}
