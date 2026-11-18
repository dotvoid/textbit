import { useCallback, useState } from 'react'
import { LabEditor, LAB_URL, labDocument } from './LabEditor'

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
    labDocument()
      .then(setJoined)
      .catch(() => setProblem(`No lab at ${LAB_URL}. Start it with npm run lab.`))
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

