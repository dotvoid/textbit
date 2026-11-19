import { useEffect, useState } from 'react'
import * as Y from '@y/y'
import { Textbit } from '@dotvoid/textbit'
import type { DocumentHandle, Unreviewed } from '@dotvoid/y-quorum-client'
import type { TBPlugin } from '@dotvoid/textbit'

type Comparison = Awaited<ReturnType<DocumentHandle['compare']>> & { label: string }
type Moment = { seq: number, content: Y.Node }

/**
 * The versions of a document on the server: save one, compare one with the
 * text as it is now, restore one
 */
export const VersionsPanel = ({ handle, plugins }: { handle: DocumentHandle, plugins: TBPlugin[] }) => {
  const [versions, setVersions] = useState(() => [...handle.versions])
  const [label, setLabel] = useState('')
  const [comparison, setComparison] = useState<Comparison>()
  const [moment, setMoment] = useState<Moment>()
  const [log, setLog] = useState(handle.log)
  const [waiting, setWaiting] = useState<Unreviewed[]>([])

  // What agents wrote that nobody has reviewed, again whenever someone writes
  useEffect(() => {
    let current = true
    const update = () => {
      handle.unreviewed().then((found) => current && setWaiting(found), () => undefined)
    }
    update()
    handle.on('attributions', update)
    return () => {
      current = false
      handle.off('attributions', update)
    }
  }, [handle])
  const [problem, setProblem] = useState('')
  const may = handle.capabilities.versions

  useEffect(() => {
    const update = () => setVersions([...handle.versions])
    handle.on('versions', update)
    return () => handle.off('versions', update)
  }, [handle])

  // How far back there is to go grows as people write
  useEffect(() => {
    const update = () => setLog(handle.log)
    handle.doc.on('update', update)
    handle.on('saved', update)
    return () => {
      handle.doc.off('update', update)
      handle.off('saved', update)
    }
  }, [handle])

  if (!may) {
    return null
  }
  const attempt = (work: Promise<unknown>) => {
    setProblem('')
    work.catch((error: Error) => setProblem(error.message))
  }

  return (
    <section className='demo-versions' aria-label='Versions'>
      <h3>Versions</h3>
      {may !== 'read' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            attempt(handle.save(label.trim() || `Version ${versions.length + 1}`).then(() => setLabel('')))
          }}
        >
          <input aria-label='Name of the version' placeholder='Name' value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type='submit'>Save a version</button>
        </form>
      )}
      {problem && <p role='alert'>{problem}</p>}
      {may !== 'read' && (
        <p className='demo-review' role='status'>
          {waiting.length
            ? `Written by agents and not reviewed: ${waiting.reduce((sum, group) => sum + group.length, 0)} characters in ${waiting.length} ${waiting.length === 1 ? 'run' : 'runs'}`
            : 'Nothing written by agents waits for review'}
          {waiting.length > 0 && (
            <button type='button' onClick={() => attempt(handle.review().then(setWaiting))}>Mark reviewed</button>
          )}
        </p>
      )}
      <label className='demo-scrub'>
        Back in time
        <input
          type='range'
          min={0}
          max={log}
          value={moment?.seq ?? log}
          onChange={(e) => {
            const seq = Number(e.target.value)
            if (seq >= log) {
              setMoment(undefined)
              return
            }
            attempt(handle.version(seq).then((doc) => setMoment({ seq, content: doc.get('content') })))
          }}
        />
        <span>{moment ? `at change ${moment.seq} of ${log}` : 'now'}</span>
      </label>
      {moment && (
        <div className='demo-diff'>
          <Textbit.Root key={moment.seq} value={moment.content.getAttr('body') as Y.Node} plugins={plugins} readOnly>
            <Textbit.Editable aria-label={`The text at change ${moment.seq}`} />
          </Textbit.Root>
        </div>
      )}
      <ol>
        {[...versions].reverse().map((version) => (
          <li key={version.id}>
            <span>
              <strong>{version.label ?? 'Version'}</strong>
              {` by ${version.by.name}, ${new Date(version.at).toLocaleTimeString()}`}
            </span>
            <button
              type='button'
              onClick={() => attempt(handle.compare(version.id).then((found) => setComparison({ ...found, label: version.label ?? 'Version' })))}
            >
              Compare with now
            </button>
            {may === 'restore' && (
              <button type='button' onClick={() => attempt(handle.restore(version.id).then(() => setComparison(undefined)))}>
                Restore
              </button>
            )}
          </li>
        ))}
      </ol>
      {comparison && (
        <div className='demo-diff'>
          <p>
            What changed since “{comparison.label}”
            <button type='button' onClick={() => setComparison(undefined)}>Close</button>
          </p>
          <Textbit.Root value={comparison.content.getAttr('body') as Y.Node} renderer={comparison.renderer} plugins={plugins} readOnly>
            <Textbit.Editable aria-label={`Changes since ${comparison.label}`} />
          </Textbit.Root>
        </div>
      )}
    </section>
  )
}
