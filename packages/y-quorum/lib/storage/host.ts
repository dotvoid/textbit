import type { Storage } from '../types'
import { memory } from './memory'

/** A host's own store, in JSON */
export interface HostStore {
  /** A document as the host keeps it: its type and content, and a version that changes when it does */
  load(namespace: string, id: string): Promise<{ type: string, content: Record<string, unknown>, version?: string } | undefined>
  /** The document as JSON, after changes: on a debounce and when it is unloaded */
  store(namespace: string, id: string, document: { type: string, content: Record<string, unknown> }): Promise<void>
}

/**
 * Storage for a host that keeps documents as JSON in its own database. Y.js
 * state and the log are kept in `cache` (memory by default, SQLite to survive
 * restarts); a document the cache lacks is seeded from the host's JSON. The
 * JSON goes back to the host when a document is unloaded.
 */
export function host(store: HostStore, { cache = memory() }: { cache?: Storage } = {}): Storage & { seedFrom: HostStore } {
  return {
    ...cache,
    seedFrom: store,
    unloaded: async (namespace, id, state, json, type) => {
      await cache.unloaded?.(namespace, id, state, json, type)
      await store.store(namespace, id, { type, content: json })
    }
  }
}
