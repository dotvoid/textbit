import { createContext, useContext } from 'react'
import type { Awareness } from '@y/protocols/awareness'
import type { TBCursorOptions } from '../yjs/cursors'

/** @internal The awareness of a shared document, and how cursors are shared through it */
export const SharedAwarenessContext = createContext<{ awareness: Awareness | null, cursor?: TBCursorOptions }>({ awareness: null })

/** @internal The awareness of the shared document the editor is on, if any */
export function useSharedAwareness() {
  return useContext(SharedAwarenessContext)
}
