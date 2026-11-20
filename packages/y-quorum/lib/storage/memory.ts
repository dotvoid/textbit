import type { DocumentRecord, VersionInfo } from '@dotvoid/y-quorum-client/protocol'
import { StaleLease, type Checkpoint, type Lease, type LogEntry, type Storage, type StoredMeta } from '../types'
import type { HistoryEntry } from '../history'

interface Kept {
  meta: StoredMeta
  checkpoint: Checkpoint & { seq: number }
  entries: LogEntry[]
  records: DocumentRecord[]
  versions: Array<{ version: VersionInfo, state: Uint8Array }>
  history: HistoryEntry[]
  claims: Map<number, string>
}

/** Storage in memory: for tests and trying things out. Gone when the process ends. */
export function memory(): Storage {
  const documents = new Map<string, Kept>()
  // Leases outlive what they lease: a document deleted and made again keeps counting epochs
  const leases = new Map<string, Lease>()
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
        records: [...kept.records],
        versions: kept.versions.map(({ version }) => version),
        ...(kept.history.length ? { historyHead: { seq: kept.history.at(-1)!.seq, hash: kept.history.at(-1)!.hash, to: kept.history.at(-1)!.to } } : {})
      }
    },
    create: async (namespace, id, meta, checkpoint) => {
      const key = keyOf(namespace, id)
      if (documents.has(key)) {
        throw new Error(`y-quorum: ${namespace}/${id} exists`)
      }
      documents.set(key, { meta, checkpoint: { ...checkpoint, seq: 0 }, entries: [], records: [], versions: [], history: [], claims: new Map() })
    },
    append: async (namespace, id, entries, epoch) => {
      if (epoch !== undefined && leases.get(keyOf(namespace, id))?.epoch !== epoch) {
        throw new StaleLease(namespace, id)
      }
      get(namespace, id).entries.push(...entries)
    },
    lease: async (namespace, id, node, ttl) => {
      const key = keyOf(namespace, id)
      const now = Date.now()
      const current = leases.get(key)
      if (!current || current.until <= now) {
        leases.set(key, { holder: node.id, address: node.address, epoch: (current?.epoch ?? 0) + 1, until: now + ttl })
      } else if (current.holder === node.id) {
        leases.set(key, { ...current, address: node.address, until: now + ttl })
      }
      return { ...leases.get(key)! }
    },
    releaseLease: async (namespace, id, node) => {
      const current = leases.get(keyOf(namespace, id))
      if (current?.holder === node) {
        current.until = 0
      }
    },
    prune: async (namespace, id, { before, upTo }) => {
      const kept = get(namespace, id)
      kept.entries = kept.entries.filter((entry) => entry.at >= before || entry.seq > upTo)
      for (const entry of kept.history) {
        if (entry.until < before) {
          delete entry.payload
        }
      }
    },
    clientHolder: async (namespace, id, client) => documents.get(keyOf(namespace, id))?.claims.get(client),
    checkpoint: async (namespace, id, checkpoint, seq) => {
      get(namespace, id).checkpoint = { ...checkpoint, seq }
    },
    appendRecord: async (namespace, id, record) => {
      get(namespace, id).records.push(record)
    },
    log: async (namespace, id, from = 0) => get(namespace, id).entries.filter((entry) => entry.seq > from),
    appendHistory: async (namespace, id, entries) => {
      get(namespace, id).history.push(...entries)
    },
    history: async (namespace, id, from = 0) => get(namespace, id).history.filter((entry) => entry.seq > from),
    addVersion: async (namespace, id, version, state) => {
      get(namespace, id).versions.push({ version, state })
    },
    versionState: async (namespace, id, versionId) =>
      get(namespace, id).versions.find(({ version }) => version.id === versionId)?.state,
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
