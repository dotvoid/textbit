import type { Path, PathRef } from 'slate'

/**
 * A pending drop/paste consumer that is currently running (`await consume()`
 * has not yet resolved or failed). Ephemeral state — never syncs to the
 * shared document.
 *
 * - `source: 'own'` marks a drop initiated by this session. Tracked locally
 *   via React state and a Slate `PathRef`.
 * - `source: 'peer'` marks a drop initiated by another peer, received via
 *   Yjs awareness. `peerId` is the Yjs client id; `peerData` is the peer's
 *   cursor data (typically `{ name, color, ... }` — whatever the consumer
 *   configured via `withCursors`).
 *
 * Peer drops vanish automatically when a peer disconnects — Yjs awareness
 * clears their state and broadcasts that clearance to everyone. No cleanup
 * code required.
 */
export interface PendingDrop {
  /** Tells drops apart */
  id: string
  /** `own` for a drop in this editor, `peer` for one by someone else in the document */
  source: 'own' | 'peer'
  /** Where the result will be inserted, as a top-level path */
  path: Path
  /** What it will make, the type a consumer named, e.g. `base/image` */
  kind?: string
  /** For a peer's drop: their Y.js client id */
  peerId?: number
  /** For a peer's drop: their cursor data, e.g. `{ name, color }` */
  peerData?: unknown
}

/**
 * Write API attached to the editor by `PendingDropsProvider` so `pipes.ts`
 * (running from drop/paste event handlers without React context) can add and
 * remove entries. Also part of the context value below.
 */
export interface PendingDropsController {
  /** Mark a drop in progress at a place; returns its id */
  start: (opts: { pathRef: PathRef, kind?: string }) => string
  /** The drop is done, or failed */
  end: (id: string) => void
}
