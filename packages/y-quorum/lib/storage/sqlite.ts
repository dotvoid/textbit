import { DatabaseSync } from 'node:sqlite'
import type { DocumentRecord, Layer, Person, VersionInfo } from '@dotvoid/y-quorum-client/protocol'
import type { Actor, Checkpoint, LogEntry, Storage } from '../types'
import type { HistoryEntry } from '../history'

/**
 * Storage in one SQLite file, through Node's built-in `node:sqlite`: the
 * default for a server in one process, no other software needed.
 */
export function sqlite(file: string): Storage {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS documents (
      namespace TEXT NOT NULL, id TEXT NOT NULL,
      type TEXT NOT NULL, incarnation TEXT NOT NULL, created_at INTEGER NOT NULL,
      checkpoint BLOB NOT NULL, checkpoint_seq INTEGER NOT NULL,
      PRIMARY KEY (namespace, id)
    );
    CREATE TABLE IF NOT EXISTS layer_checkpoints (
      namespace TEXT NOT NULL, id TEXT NOT NULL, layer TEXT NOT NULL, state BLOB NOT NULL,
      PRIMARY KEY (namespace, id, layer)
    );
    CREATE TABLE IF NOT EXISTS log (
      namespace TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
      at INTEGER NOT NULL, layer TEXT NOT NULL, actor TEXT NOT NULL, update_ BLOB NOT NULL,
      PRIMARY KEY (namespace, id, seq)
    );
    CREATE TABLE IF NOT EXISTS records (
      namespace TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
      kind TEXT NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL, on_behalf_of TEXT, data TEXT NOT NULL,
      PRIMARY KEY (namespace, id, seq)
    );
    CREATE TABLE IF NOT EXISTS versions (
      namespace TEXT NOT NULL, id TEXT NOT NULL, version_id TEXT NOT NULL, seq INTEGER NOT NULL,
      info TEXT NOT NULL, state BLOB NOT NULL,
      PRIMARY KEY (namespace, id, version_id)
    );
    CREATE TABLE IF NOT EXISTS history (
      namespace TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL,
      entry TEXT NOT NULL, payload BLOB, hash TEXT NOT NULL,
      PRIMARY KEY (namespace, id, seq)
    );
    CREATE TABLE IF NOT EXISTS claims (
      namespace TEXT NOT NULL, id TEXT NOT NULL, client INTEGER NOT NULL, principal TEXT NOT NULL,
      PRIMARY KEY (namespace, id, client)
    );
  `)
  const loadDocument = db.prepare('SELECT type, incarnation, created_at, checkpoint, checkpoint_seq FROM documents WHERE namespace = ? AND id = ?')
  const loadLog = db.prepare('SELECT seq, at, layer, actor, update_ FROM log WHERE namespace = ? AND id = ? AND seq > ? ORDER BY seq')
  const loadRecords = db.prepare('SELECT seq, kind, at, actor, on_behalf_of, data FROM records WHERE namespace = ? AND id = ? ORDER BY seq')
  const insertDocument = db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, 0)')
  // The content's state is in documents; the rest of a checkpoint beside it,
  // by key: another layer's state, `attributions:<layer>`, or `people`
  const loadLayers = db.prepare('SELECT layer, state FROM layer_checkpoints WHERE namespace = ? AND id = ?')
  const putLayer = db.prepare('INSERT OR REPLACE INTO layer_checkpoints VALUES (?, ?, ?, ?)')
  const insertEntry = db.prepare('INSERT INTO log VALUES (?, ?, ?, ?, ?, ?, ?)')
  const updateCheckpoint = db.prepare('UPDATE documents SET checkpoint = ?, checkpoint_seq = ? WHERE namespace = ? AND id = ?')
  const insertRecord = db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const insertHistory = db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?, ?)')
  const loadHistory = db.prepare('SELECT entry, payload FROM history WHERE namespace = ? AND id = ? AND seq > ? ORDER BY seq')
  const loadHistoryHead = db.prepare('SELECT seq, hash FROM history WHERE namespace = ? AND id = ? ORDER BY seq DESC LIMIT 1')
  const insertVersion = db.prepare('INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?)')
  const loadVersions = db.prepare('SELECT info FROM versions WHERE namespace = ? AND id = ? ORDER BY seq, rowid')
  const loadVersionState = db.prepare('SELECT state FROM versions WHERE namespace = ? AND id = ? AND version_id = ?')
  const findClaim = db.prepare('SELECT principal FROM claims WHERE namespace = ? AND id = ? AND client = ?')
  const insertClaim = db.prepare('INSERT INTO claims VALUES (?, ?, ?, ?)')

  function transaction(work: () => void) {
    db.exec('BEGIN')
    try {
      work()
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  function putParts(namespace: string, id: string, checkpoint: Checkpoint) {
    for (const [layer, state] of Object.entries(checkpoint.states)) {
      if (layer !== 'content' && state) {
        putLayer.run(namespace, id, layer, state)
      }
    }
    for (const [layer, map] of Object.entries(checkpoint.attributions ?? {})) {
      if (map) {
        putLayer.run(namespace, id, `attributions:${layer}`, map)
      }
    }
    if (checkpoint.reviewed) {
      putLayer.run(namespace, id, 'reviewed', checkpoint.reviewed)
    }
    if (checkpoint.people) {
      putLayer.run(namespace, id, 'people', new TextEncoder().encode(JSON.stringify(checkpoint.people)))
    }
  }

  return {
    load: async (namespace, id) => {
      const row = loadDocument.get(namespace, id) as {
        type: string, incarnation: string, created_at: number, checkpoint: Uint8Array, checkpoint_seq: number
      } | undefined
      if (!row) {
        return undefined
      }
      const entries = (loadLog.all(namespace, id, row.checkpoint_seq) as Array<{
        seq: number, at: number, layer: string, actor: string, update_: Uint8Array
      }>).map((entry): LogEntry => ({
        seq: entry.seq,
        at: entry.at,
        layer: entry.layer as Layer,
        actor: JSON.parse(entry.actor) as Actor,
        update: new Uint8Array(entry.update_)
      }))
      const checkpoint: Checkpoint = { states: { content: new Uint8Array(row.checkpoint) } }
      for (const part of loadLayers.all(namespace, id) as Array<{ layer: string, state: Uint8Array }>) {
        const bytes = new Uint8Array(part.state)
        if (part.layer === 'reviewed') {
          checkpoint.reviewed = bytes
        } else if (part.layer === 'people') {
          checkpoint.people = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, Person>
        } else if (part.layer.startsWith('attributions:')) {
          checkpoint.attributions = { ...checkpoint.attributions, [part.layer.slice('attributions:'.length)]: bytes }
        } else {
          checkpoint.states[part.layer as Layer] = bytes
        }
      }
      const records = (loadRecords.all(namespace, id) as Array<{
        seq: number, kind: string, at: number, actor: string, on_behalf_of: string | null, data: string
      }>).map((record): DocumentRecord => ({
        seq: record.seq,
        kind: record.kind,
        at: record.at,
        actor: JSON.parse(record.actor) as DocumentRecord['actor'],
        ...(record.on_behalf_of ? { onBehalfOf: JSON.parse(record.on_behalf_of) as DocumentRecord['actor'] } : {}),
        data: JSON.parse(record.data) as unknown
      }))
      const versions = (loadVersions.all(namespace, id) as Array<{ info: string }>)
        .map((version) => JSON.parse(version.info) as VersionInfo)
      const head = loadHistoryHead.get(namespace, id) as { seq: number, hash: string } | undefined
      return {
        meta: { type: row.type, incarnation: row.incarnation, createdAt: row.created_at },
        versions,
        ...(head ? { historyHead: { seq: head.seq, hash: head.hash } } : {}),
        checkpoint: { ...checkpoint, seq: row.checkpoint_seq },
        entries,
        records
      }
    },
    create: async (namespace, id, meta, checkpoint) => {
      transaction(() => {
        insertDocument.run(namespace, id, meta.type, meta.incarnation, meta.createdAt, checkpoint.states.content ?? new Uint8Array())
        putParts(namespace, id, checkpoint)
      })
    },
    append: async (namespace, id, entries) => {
      transaction(() => {
        for (const entry of entries) {
          insertEntry.run(namespace, id, entry.seq, entry.at, entry.layer, JSON.stringify(entry.actor), entry.update)
        }
      })
    },
    checkpoint: async (namespace, id, checkpoint, seq) => {
      transaction(() => {
        updateCheckpoint.run(checkpoint.states.content ?? new Uint8Array(), seq, namespace, id)
        putParts(namespace, id, checkpoint)
      })
    },
    log: async (namespace, id, from = 0) =>
      (loadLog.all(namespace, id, from) as Array<{ seq: number, at: number, layer: string, actor: string, update_: Uint8Array }>)
        .map((entry): LogEntry => ({
          seq: entry.seq,
          at: entry.at,
          layer: entry.layer as Layer,
          actor: JSON.parse(entry.actor) as Actor,
          update: new Uint8Array(entry.update_)
        })),
    appendHistory: async (namespace, id, entries) => {
      transaction(() => {
        for (const entry of entries) {
          const { payload, ...rest } = entry
          insertHistory.run(namespace, id, entry.seq, JSON.stringify(rest), payload ?? null, entry.hash)
        }
      })
    },
    history: async (namespace, id, from = 0) =>
      (loadHistory.all(namespace, id, from) as Array<{ entry: string, payload: Uint8Array | null }>).map((row): HistoryEntry => ({
        ...(JSON.parse(row.entry) as Omit<HistoryEntry, 'payload'>),
        ...(row.payload ? { payload: new Uint8Array(row.payload) } : {})
      })),
    addVersion: async (namespace, id, version, state) => {
      insertVersion.run(namespace, id, version.id, version.seq, JSON.stringify(version), state)
    },
    versionState: async (namespace, id, versionId) => {
      const row = loadVersionState.get(namespace, id, versionId) as { state: Uint8Array } | undefined
      return row ? new Uint8Array(row.state) : undefined
    },
    appendRecord: async (namespace, id, record) => {
      insertRecord.run(
        namespace, id, record.seq, record.kind, record.at, JSON.stringify(record.actor),
        record.onBehalfOf ? JSON.stringify(record.onBehalfOf) : null, JSON.stringify(record.data ?? null)
      )
    },
    claimClient: async (namespace, id, client, principal) => {
      const row = findClaim.get(namespace, id, client) as { principal: string } | undefined
      if (row) {
        return row.principal === principal
      }
      insertClaim.run(namespace, id, client, principal)
      return true
    },
    delete: async (namespace, id) => {
      for (const table of ['documents', 'layer_checkpoints', 'log', 'records', 'versions', 'history', 'claims']) {
        if (id !== undefined) {
          db.prepare(`DELETE FROM ${table} WHERE namespace = ? AND id = ?`).run(namespace, id)
        } else {
          db.prepare(`DELETE FROM ${table} WHERE namespace = ?`).run(namespace)
        }
      }
    },
    close: async () => {
      db.close()
    }
  }
}
