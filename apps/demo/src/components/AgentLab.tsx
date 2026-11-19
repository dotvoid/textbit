import { useCallback, useState } from 'react'
import { LabEditor } from './LabEditor'

/**
 * The lab's shared document, where an agent connected through MCP edits
 * alongside you. Start it with `npm run lab`; see apps/agent-lab.
 */
export const AgentLab = () => {
  const [joined, setJoined] = useState(false)
  const [problem, setProblem] = useState('')
  const leave = useCallback((reason: string) => {
    setJoined(false)
    setProblem(reason)
  }, [])

  if (!joined) {
    return (
      <p className='demo-lab-join'>
        <button type='button' onClick={() => { setProblem(''); setJoined(true) }}>Join the lab document</button>
        {' '}{problem || <>Needs <code>npm run lab</code> running.</>}
      </p>
    )
  }
  return <LabEditor onGone={leave} />
}
