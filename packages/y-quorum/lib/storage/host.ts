import type { CommentThread } from '@dotvoid/y-quorum-client/model'
import type { Storage } from '../types'
import { memory } from './memory'

/** A document as a host keeps it in JSON */
export interface HostDocument {
  type: string
  content: Record<string, unknown>
  /** Its comment threads, for a type that has comments */
  comments?: CommentThread[]
}

/** A host's own store, in JSON */
export interface HostStore {
  /** A document as the host keeps it */
  load(namespace: string, id: string): Promise<HostDocument | undefined>
  /**
   * The document as JSON: a while after it last changed (the server's
   * `settleAfter`), and when it is unloaded
   */
  store(namespace: string, id: string, document: HostDocument): Promise<void>
}

/**
 * Storage for a host that keeps documents as JSON in its own database. Y.js
 * state and the log are kept in `cache` (memory by default, SQLite to survive
 * restarts); a document the cache lacks is seeded from the host's JSON. The
 * JSON goes back to the host a while after each change, and when a document
 * is unloaded.
 */
export function host(store: HostStore, { cache = memory() }: { cache?: Storage } = {}): Storage & { seedFrom: HostStore } {
  return {
    ...cache,
    seedFrom: store,
    settled: async (namespace, id, json, type, comments) => {
      await cache.settled?.(namespace, id, json, type, comments)
      await store.store(namespace, id,
        { type, content: json, ...(comments.length ? { comments } : {}) })
    },
    unloaded: async (namespace, id, state, json, type, comments) => {
      await cache.unloaded?.(namespace, id, state, json, type, comments)
      await store.store(namespace, id, { type, content: json, ...(comments.length ? { comments } : {}) })
    }
  }
}
