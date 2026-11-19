import { useEffect, useState } from 'react'
import * as Y from '@y/y'
import { Textbit } from '@dotvoid/textbit'
import type { DocumentHandle } from '@dotvoid/y-quorum-client'
import type { TBPlugin } from '@dotvoid/textbit'

type Comparison = Awaited<ReturnType<DocumentHandle['compare']>> & { label: string }

/**
 * The versions of a document on the server: save one, compare one with the
 * text as it is now, restore one
 */
export const VersionsPanel = ({ handle, plugins }: { handle: DocumentHandle, plugins: TBPlugin[] }) => {
  const [versions, setVersions] = useState(() => [...handle.versions])
  const [label, setLabel] = useState('')
  const [comparison, setComparison] = useState<Comparison>()
  const [problem, setProblem] = useState('')
  const may = handle.capabilities.versions

  useEffect(() => {
    const update = () => setVersions([...handle.versions])
    handle.on('versions', update)
    return () => handle.off('versions', update)
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
