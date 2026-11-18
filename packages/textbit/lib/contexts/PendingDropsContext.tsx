import { createContext } from 'react'

import type { PendingDrop, PendingDropsController } from '../types/pendingDrops'

export type { PendingDrop, PendingDropsController }

/**
 * Read + write access to the pending-drops store. Consumers (a marker
 * component) read `drops` and re-render when it changes.
 */
export interface PendingDropsContextValue extends PendingDropsController {
  /** The drops in progress, own and peers' */
  drops: PendingDrop[]
}

/**
 * The drops and uploads in progress, inside `Textbit.Editable`. Most hosts
 * read them with `usePendingDrops()`; the context is for markers of your own
 * that also start and end drops.
 */
export const PendingDropsContext = createContext<PendingDropsContextValue | null>(null)
