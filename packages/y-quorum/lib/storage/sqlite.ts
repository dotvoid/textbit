import { DatabaseSync } from 'node:sqlite'
import type { DocumentRecord } from '@dotvoid/y-quorum-client/protocol'
import type { Actor, LogEntry, Storage } from '../types'

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
    CREATE TABLE IF NOT EXISTS claims (
      namespace TEXT NOT NULL, id TEXT NOT NULL, client INTEGER NOT NULL, principal TEXT NOT NULL,
      PRIMARY KEY (namespace, id, client)
    );
  `)
  const loadDocument = db.prepare('SELECT type, incarnation, created_at, checkpoint, checkpoint_seq FROM documents WHERE namespace = ? AND id = ?')
  const loadLog = db.prepare('SELECT seq, at, layer, actor, update_ FROM log WHERE namespace = ? AND id = ? AND seq > ? ORDER BY seq')
  const loadRecords = db.prepare('SELECT seq, kind, at, actor, on_behalf_of, data FROM records WHERE namespace = ? AND id = ? ORDER BY seq')
  const insertDocument = db.prepare('INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, 0)')
  const insertEntry = db.prepare('INSERT INTO log VALUES (?, ?, ?, ?, ?, ?, ?)')
  const updateCheckpoint = db.prepare('UPDATE documents SET checkpoint = ?, checkpoint_seq = ? WHERE namespace = ? AND id = ?')
  const insertRecord = db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const findClaim = db.prepare('SELECT principal FROM claims WHERE namespace = ? AND id = ? AND client = ?')
  const insertClaim = db.prepare('INSERT INTO claims VALUES (?, ?, ?, ?)')

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
        layer: entry.layer,
        actor: JSON.parse(entry.actor) as Actor,
        update: new Uint8Array(entry.update_)
      }))
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
      return {
        meta: { type: row.type, incarnation: row.incarnation, createdAt: row.created_at },
        checkpoint: { state: new Uint8Array(row.checkpoint), seq: row.checkpoint_seq },
        entries,
        records
      }
    },
    create: async (namespace, id, meta, state) => {
      insertDocument.run(namespace, id, meta.type, meta.incarnation, meta.createdAt, state)
    },
    append: async (namespace, id, entries) => {
      db.exec('BEGIN')
      try {
        for (const entry of entries) {
          insertEntry.run(namespace, id, entry.seq, entry.at, entry.layer, JSON.stringify(entry.actor), entry.update)
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
    checkpoint: async (namespace, id, state, seq) => {
      updateCheckpoint.run(state, seq, namespace, id)
    },
    log: async (namespace, id, from = 0) =>
      (loadLog.all(namespace, id, from) as Array<{ seq: number, at: number, layer: string, actor: string, update_: Uint8Array }>)
        .map((entry): LogEntry => ({
          seq: entry.seq,
          at: entry.at,
          layer: entry.layer,
          actor: JSON.parse(entry.actor) as Actor,
          update: new Uint8Array(entry.update_)
        })),
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
      for (const table of ['documents', 'log', 'records', 'claims']) {
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
