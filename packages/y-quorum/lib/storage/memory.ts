import type { DocumentRecord } from '@dotvoid/y-quorum-client/protocol'
import type { Checkpoint, LogEntry, Storage, StoredMeta } from '../types'

interface Kept {
  meta: StoredMeta
  checkpoint: Checkpoint & { seq: number }
  entries: LogEntry[]
  records: DocumentRecord[]
  claims: Map<number, string>
}

/** Storage in memory: for tests and trying things out. Gone when the process ends. */
export function memory(): Storage {
  const documents = new Map<string, Kept>()
  const keyOf = (namespace: string, id: string) => `${namespace}\u0000${id}`
  const get = (namespace: string, id: string) => {
    const kept = documents.get(keyOf(namespace, id))
    if (!kept) {
      throw new Error(`y-quorum: no document ${namespace}/${id}`)
    }
    return kept
  }

  return {
    load: async (namespace, id) => {
      const kept = documents.get(keyOf(namespace, id))
      return kept && {
        meta: kept.meta,
        checkpoint: kept.checkpoint,
        entries: kept.entries.filter((entry) => entry.seq > kept.checkpoint.seq),
        records: [...kept.records]
      }
    },
    create: async (namespace, id, meta, checkpoint) => {
      const key = keyOf(namespace, id)
      if (documents.has(key)) {
        throw new Error(`y-quorum: ${namespace}/${id} exists`)
      }
      documents.set(key, { meta, checkpoint: { ...checkpoint, seq: 0 }, entries: [], records: [], claims: new Map() })
    },
    append: async (namespace, id, entries) => {
      get(namespace, id).entries.push(...entries)
    },
    checkpoint: async (namespace, id, checkpoint, seq) => {
      get(namespace, id).checkpoint = { ...checkpoint, seq }
    },
    appendRecord: async (namespace, id, record) => {
      get(namespace, id).records.push(record)
    },
    log: async (namespace, id, from = 0) => get(namespace, id).entries.filter((entry) => entry.seq > from),
    claimClient: async (namespace, id, client, principal) => {
      const claims = get(namespace, id).claims
      const holder = claims.get(client)
      if (holder !== undefined && holder !== principal) {
        return false
      }
      claims.set(client, principal)
      return true
    },
    delete: async (namespace, id) => {
      for (const key of [...documents.keys()]) {
        if (id !== undefined ? key === keyOf(namespace, id) : key.startsWith(`${namespace}\u0000`)) {
          documents.delete(key)
        }
      }
    }
  }
}
