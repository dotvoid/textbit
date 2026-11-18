import { createContext } from 'react'

import type { PendingDrop, PendingDropsController } from '../types/pendingDrops'

export type { PendingDrop, PendingDropsController }

/**
 * Read + write access to the pending-drops store. Consumers (a marker
 * component) read `drops` and re-render when it changes.
 */
export interface PendingDropsContextValue extends PendingDropsController {
  drops: PendingDrop[]
}

export const PendingDropsContext = createContext<PendingDropsContextValue | null>(null)
