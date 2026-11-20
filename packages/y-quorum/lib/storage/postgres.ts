import type { DocumentRecord, Layer, Person, VersionInfo } from '@dotvoid/y-quorum-client/protocol'
import {
  StaleLease, type Actor, type Checkpoint, type Lease, type LogEntry, type Storage
} from '../types'
import type { HistoryEntry } from '../history'

/**
 * What the adapter needs of a Postgres client: node-postgres's `Pool` and
 * PGlite both have it. Every call is one statement, so a pool may run each on
 * a different connection: nothing relies on a transaction spanning calls.
 */
export interface PostgresClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

export interface PostgresOptions {
  /** The schema the tables live in, created when missing. Default: `y_quorum`. */
  schema?: string
}

type Row = Record<string, unknown>
type Param = string | number | Uint8Array | null

/**
 * Storage in Postgres. The caller passes the client and owns it: the adapter
 * creates its tables on first use and never closes the client, so several
 * servers may share one. The namespace leads every key, so a namespace is
 * deleted in one statement per table, and tables can be partitioned by it.
 */
export function postgres(db: PostgresClient, options: PostgresOptions = {}): Storage {
  const schema = `"${(options.schema ?? 'y_quorum').replaceAll('"', '""')}"`
  const t = (table: string) => `${schema}.${table}`
  // Leases are not deleted with a document: their epochs keep growing
  const tables = [
    'documents', 'checkpoint_parts', 'log', 'records', 'versions', 'history', 'claims', 'people'
  ]

  let ready: Promise<void> | undefined
  // Created once per adapter; a failure is forgotten so the next call tries again
  const setup = () => {
    ready ??= createTables().catch((error: unknown) => {
      ready = undefined
      throw error
    })
    return ready
  }

  async function createTables() {
    const statements = [
      `CREATE SCHEMA IF NOT EXISTS ${schema}`,
      `CREATE TABLE IF NOT EXISTS ${t('documents')} (
        namespace text NOT NULL, id text NOT NULL,
        type text NOT NULL, incarnation text NOT NULL, created_at bigint NOT NULL,
        checkpoint_seq bigint NOT NULL,
        PRIMARY KEY (namespace, id))`,
      // A checkpoint by part: a layer's state, `attributions:<layer>`, `reviewed` or `people`
      `CREATE TABLE IF NOT EXISTS ${t('checkpoint_parts')} (
        namespace text NOT NULL, id text NOT NULL, part text NOT NULL, state bytea NOT NULL,
        PRIMARY KEY (namespace, id, part))`,
      `CREATE TABLE IF NOT EXISTS ${t('log')} (
        namespace text NOT NULL, id text NOT NULL, seq bigint NOT NULL,
        at bigint NOT NULL, layer text NOT NULL, actor jsonb NOT NULL, body bytea NOT NULL,
        PRIMARY KEY (namespace, id, seq))`,
      `CREATE TABLE IF NOT EXISTS ${t('records')} (
        namespace text NOT NULL, id text NOT NULL, seq bigint NOT NULL,
        kind text NOT NULL, at bigint NOT NULL, actor jsonb NOT NULL, on_behalf_of jsonb,
        data jsonb NOT NULL,
        PRIMARY KEY (namespace, id, seq))`,
      // `position` keeps the order versions were added in, for versions at one seq
      `CREATE TABLE IF NOT EXISTS ${t('versions')} (
        namespace text NOT NULL, id text NOT NULL, version_id text NOT NULL,
        position bigint GENERATED ALWAYS AS IDENTITY,
        seq bigint NOT NULL, info jsonb NOT NULL, state bytea NOT NULL,
        PRIMARY KEY (namespace, id, version_id))`,
      `CREATE TABLE IF NOT EXISTS ${t('history')} (
        namespace text NOT NULL, id text NOT NULL, seq bigint NOT NULL,
        entry jsonb NOT NULL, payload bytea, hash text NOT NULL,
        PRIMARY KEY (namespace, id, seq))`,
      `CREATE TABLE IF NOT EXISTS ${t('people')} (
        namespace text NOT NULL, id text NOT NULL, key text NOT NULL, person jsonb NOT NULL,
        PRIMARY KEY (namespace, id, key))`,
      `CREATE TABLE IF NOT EXISTS ${t('claims')} (
        namespace text NOT NULL, id text NOT NULL, client bigint NOT NULL,
        principal text NOT NULL,
        PRIMARY KEY (namespace, id, client))`,
      // `until` is in milliseconds by the database's clock, which every node shares
      `CREATE TABLE IF NOT EXISTS ${t('leases')} (
        namespace text NOT NULL, id text NOT NULL,
        holder text NOT NULL, address text NOT NULL, epoch bigint NOT NULL, until bigint NOT NULL,
        PRIMARY KEY (namespace, id))`
    ]
    // One by one: PGlite's `query` takes one statement at a time
    for (const statement of statements) {
      await db.query(statement)
    }
  }

  // Whether the document of $1 and $2 is still there: what is written beside
  // it once it is deleted, by a node that has not noticed yet, is not kept
  const there = () =>
    `EXISTS (SELECT 1 FROM ${t('documents')} d WHERE d.namespace = $1 AND d.id = $2)`

  async function query(text: string, params: Param[] = []) {
    await setup()
    return (await db.query(text, params)).rows
  }

  function partsOf(checkpoint: Checkpoint): Array<[string, Uint8Array]> {
    const parts: Array<[string, Uint8Array]> = [
      ['content', checkpoint.states.content ?? new Uint8Array()]
    ]
    for (const [layer, state] of Object.entries(checkpoint.states)) {
      if (layer !== 'content' && state) {
        parts.push([layer, state])
      }
    }
    for (const [layer, map] of Object.entries(checkpoint.attributions ?? {})) {
      if (map) {
        parts.push([`attributions:${layer}`, map])
      }
    }
    if (checkpoint.reviewed) {
      parts.push(['reviewed', checkpoint.reviewed])
    }
    if (checkpoint.people) {
      parts.push(['people', new TextEncoder().encode(JSON.stringify(checkpoint.people))])
    }
    return parts
  }

  const logEntry = (row: Row): LogEntry => ({
    seq: num(row.seq),
    at: num(row.at),
    layer: str(row.layer) as Layer,
    actor: json<Actor>(row.actor),
    update: bytes(row.body)
  })

  const readLog = (namespace: string, id: string, from: number) => query(
    `SELECT seq, at, layer, actor::text AS actor, body FROM ${t('log')}
      WHERE namespace = $1 AND id = $2 AND seq > $3 ORDER BY seq`,
    [namespace, id, from]
  )

  return {
    load: async (namespace, id) => {
      // The document and its checkpoint in one statement, so a checkpoint
      // written meanwhile is not read half old, half new
      const parts = await query(
        `SELECT d.type, d.incarnation, d.created_at, d.checkpoint_seq, p.part, p.state
          FROM ${t('documents')} d
          JOIN ${t('checkpoint_parts')} p ON p.namespace = d.namespace AND p.id = d.id
          WHERE d.namespace = $1 AND d.id = $2`,
        [namespace, id]
      )
      const first = parts[0]
      if (!first) {
        return undefined
      }
      const seq = num(first.checkpoint_seq)
      const checkpoint: Checkpoint = { states: {} }
      for (const row of parts) {
        const part = str(row.part)
        const state = bytes(row.state)
        if (part === 'reviewed') {
          checkpoint.reviewed = state
        } else if (part === 'people') {
          checkpoint.people = JSON.parse(new TextDecoder().decode(state)) as Record<string, Person>
        } else if (part.startsWith('attributions:')) {
          const layer = part.slice('attributions:'.length) as Layer
          checkpoint.attributions = { ...checkpoint.attributions, [layer]: state }
        } else {
          checkpoint.states[part as Layer] = state
        }
      }
      // The log after the checkpoint read: later checkpoints keep the log whole,
      // so this is right even when one is written meanwhile
      const [entries, records, versions, heads] = await Promise.all([
        readLog(namespace, id, seq),
        query(
          `SELECT seq, kind, at, actor::text AS actor, on_behalf_of::text AS on_behalf_of,
            data::text AS data
            FROM ${t('records')} WHERE namespace = $1 AND id = $2 ORDER BY seq`,
          [namespace, id]
        ),
        query(
          `SELECT info::text AS info FROM ${t('versions')}
            WHERE namespace = $1 AND id = $2 ORDER BY seq, position`,
          [namespace, id]
        ),
        query(
          `SELECT seq, hash, entry->>'to' AS "to" FROM ${t('history')}
            WHERE namespace = $1 AND id = $2 ORDER BY seq DESC LIMIT 1`,
          [namespace, id]
        )
      ])
      const head = heads[0]
      return {
        meta: {
          type: str(first.type),
          incarnation: str(first.incarnation),
          createdAt: num(first.created_at)
        },
        versions: versions.map((row) => json<VersionInfo>(row.info)),
        ...(head
          ? { historyHead: { seq: num(head.seq), hash: str(head.hash), to: num(head.to) } }
          : {}),
        checkpoint: { ...checkpoint, seq },
        entries: entries.map(logEntry),
        records: records.map((row): DocumentRecord => ({
          seq: num(row.seq),
          kind: str(row.kind),
          at: num(row.at),
          actor: json<DocumentRecord['actor']>(row.actor),
          ...(row.on_behalf_of !== null
            ? { onBehalfOf: json<DocumentRecord['actor']>(row.on_behalf_of) }
            : {}),
          data: json<unknown>(row.data)
        }))
      }
    },

    create: async (namespace, id, meta, checkpoint) => {
      // One statement: the insert of an existing document fails, and its parts
      // with it
      const parts = values(partsOf(checkpoint), ['text', 'bytea'], 6)
      await query(
        `WITH doc AS (
          INSERT INTO ${t('documents')} VALUES ($1, $2, $3, $4, $5, 0) RETURNING namespace, id
        )
        INSERT INTO ${t('checkpoint_parts')} (namespace, id, part, state)
        SELECT doc.namespace, doc.id, v.part, v.state
        FROM doc, (VALUES ${parts.sql}) AS v(part, state)`,
        [namespace, id, meta.type, meta.incarnation, meta.createdAt, ...parts.params]
      )
    },

    append: async (namespace, id, entries, epoch) => {
      if (!entries.length) {
        return
      }
      const rows = (first: number) => values(
        entries.map((entry) => [
          entry.seq, entry.at, entry.layer, JSON.stringify(entry.actor), entry.update
        ]),
        ['bigint', 'bigint', 'text', 'jsonb', 'bytea'],
        first
      )
      const insert = (sql: string) => `
        INSERT INTO ${t('log')} (namespace, id, seq, at, layer, actor, body)
        SELECT $1, $2, v.seq, v.at, v.layer, v.actor, v.body
        FROM (VALUES ${sql}) AS v(seq, at, layer, actor, body)`
      if (epoch === undefined) {
        const { sql, params } = rows(3)
        await query(insert(sql), [namespace, id, ...params])
        return
      }
      // The lease row is share-locked while the log is written: a node taking the
      // document over waits for this write, and a write after the takeover sees
      // the new epoch and inserts nothing
      const { sql, params } = rows(4)
      const inserted = await query(
        `WITH held AS (
          SELECT 1 FROM ${t('leases')} WHERE namespace = $1 AND id = $2 AND epoch = $3 FOR SHARE
        )
        ${insert(sql)} WHERE EXISTS (SELECT 1 FROM held) RETURNING seq`,
        [namespace, id, epoch, ...params]
      )
      if (!inserted.length) {
        throw new StaleLease(namespace, id)
      }
    },

    checkpoint: async (namespace, id, checkpoint, seq) => {
      // One statement, so a load sees the old checkpoint or the new one. The
      // parts kept are upserted and the others deleted: those touch different
      // rows, which is what makes it safe in one statement.
      const parts = partsOf(checkpoint)
      const rows = values(parts, ['text', 'bytea'], 4)
      // The part names among the parameters, as an array
      const names = `ARRAY[${parts.map((_, index) => `$${4 + index * 2}::text`).join(', ')}]`
      await query(
        `WITH doc AS (
          UPDATE ${t('documents')} SET checkpoint_seq = $3 WHERE namespace = $1 AND id = $2
          RETURNING namespace, id
        ), gone AS (
          DELETE FROM ${t('checkpoint_parts')} p USING doc
          WHERE p.namespace = doc.namespace AND p.id = doc.id
            AND p.part <> ALL (${names})
        )
        INSERT INTO ${t('checkpoint_parts')} (namespace, id, part, state)
        SELECT doc.namespace, doc.id, v.part, v.state
        FROM doc, (VALUES ${rows.sql}) AS v(part, state)
        ON CONFLICT (namespace, id, part) DO UPDATE SET state = excluded.state`,
        [namespace, id, seq, ...rows.params]
      )
    },

    appendRecord: async (namespace, id, record) => {
      await query(
        `INSERT INTO ${t('records')}
          SELECT $1::text, $2::text, $3::bigint, $4::text, $5::bigint, $6::jsonb, $7::jsonb,
            $8::jsonb
          WHERE ${there()}`,
        [
          namespace, id, record.seq, record.kind, record.at, JSON.stringify(record.actor),
          record.onBehalfOf ? JSON.stringify(record.onBehalfOf) : null,
          JSON.stringify(record.data ?? null)
        ]
      )
    },

    log: async (namespace, id, from = 0) => (await readLog(namespace, id, from)).map(logEntry),

    appendHistory: async (namespace, id, entries) => {
      if (!entries.length) {
        return
      }
      const rows = values(
        entries.map((entry) => {
          const { payload, ...rest } = entry
          return [entry.seq, JSON.stringify(rest), payload ?? null, entry.hash]
        }),
        ['bigint', 'jsonb', 'bytea', 'text'],
        3
      )
      await query(
        `INSERT INTO ${t('history')} (namespace, id, seq, entry, payload, hash)
          SELECT $1, $2, v.seq, v.entry, v.payload, v.hash
          FROM (VALUES ${rows.sql}) AS v(seq, entry, payload, hash)
          WHERE ${there()}`,
        [namespace, id, ...rows.params]
      )
    },

    prune: async (namespace, id, { before, upTo }) => {
      await query(`DELETE FROM ${t('log')} WHERE namespace = $1 AND id = $2 AND at < $3 AND seq <= $4`, [namespace, id, before, upTo])
      await query(
        `UPDATE ${t('history')} SET payload = NULL WHERE namespace = $1 AND id = $2 AND (entry->>'until')::bigint < $3`,
        [namespace, id, before]
      )
    },

    history: async (namespace, id, from = 0) => {
      const rows = await query(
        `SELECT entry::text AS entry, payload FROM ${t('history')}
          WHERE namespace = $1 AND id = $2 AND seq > $3 ORDER BY seq`,
        [namespace, id, from]
      )
      return rows.map((row): HistoryEntry => ({
        ...json<Omit<HistoryEntry, 'payload'>>(row.entry),
        ...(row.payload !== null ? { payload: bytes(row.payload) } : {})
      }))
    },

    addVersion: async (namespace, id, version, state) => {
      await query(
        `INSERT INTO ${t('versions')} (namespace, id, version_id, seq, info, state)
          SELECT $1::text, $2::text, $3::text, $4::bigint, $5::jsonb, $6::bytea
          WHERE ${there()}`,
        [namespace, id, version.id, version.seq, JSON.stringify(version), state]
      )
    },

    versionState: async (namespace, id, versionId) => {
      const [row] = await query(
        `SELECT state FROM ${t('versions')} WHERE namespace = $1 AND id = $2 AND version_id = $3`,
        [namespace, id, versionId]
      )
      return row ? bytes(row.state) : undefined
    },

    claimClient: async (namespace, id, client, principal) => {
      await query(
        `INSERT INTO ${t('claims')}
          SELECT $1::text, $2::text, $3::bigint, $4::text WHERE ${there()}
          ON CONFLICT DO NOTHING`,
        [namespace, id, client, principal]
      )
      const [row] = await query(
        `SELECT principal FROM ${t('claims')} WHERE namespace = $1 AND id = $2 AND client = $3`,
        [namespace, id, client]
      )
      return row?.principal === principal
    },

    addPeople: async (namespace, id, people) => {
      for (const [key, person] of Object.entries(people)) {
        await query(
          `INSERT INTO ${t('people')}
            SELECT $1::text, $2::text, $3::text, $4::jsonb WHERE ${there()}
            ON CONFLICT (namespace, id, key) DO UPDATE SET person = EXCLUDED.person`,
          [namespace, id, key, JSON.stringify(person)]
        )
      }
    },

    people: async (namespace, id) => {
      const rows = await query(`SELECT key, person::text AS person FROM ${t('people')} WHERE namespace = $1 AND id = $2`, [namespace, id])
      return Object.fromEntries(rows.map((row) => [String(row.key), json<Person>(row.person)]))
    },

    clientHolder: async (namespace, id, client) => {
      const [row] = await query(
        `SELECT principal FROM ${t('claims')} WHERE namespace = $1 AND id = $2 AND client = $3`,
        [namespace, id, client]
      )
      return row ? str(row.principal) : undefined
    },

    lease: async (namespace, id, node, ttl) => {
      // Taken when free or run out, with the next epoch, even by the node that
      // had it; kept, with its epoch, by the node holding it.
      // `excluded.until - ttl` is now by the database.
      const [taken] = await query(
        `INSERT INTO ${t('leases')} AS l (namespace, id, holder, address, epoch, until)
          VALUES ($1, $2, $3, $4, 1,
            (extract(epoch FROM clock_timestamp()) * 1000)::bigint + $5::bigint)
          ON CONFLICT (namespace, id) DO UPDATE SET
            epoch = CASE WHEN l.holder = excluded.holder AND l.until > excluded.until - $5::bigint
              THEN l.epoch ELSE l.epoch + 1 END,
            holder = excluded.holder, address = excluded.address, until = excluded.until
          WHERE l.holder = excluded.holder OR l.until <= excluded.until - $5::bigint
          RETURNING holder, address, epoch, until`,
        [namespace, id, node.id, node.address, ttl]
      )
      const [held] = taken ? [taken] : await query(
        `SELECT holder, address, epoch, until FROM ${t('leases')} WHERE namespace = $1 AND id = $2`,
        [namespace, id]
      )
      if (!held) {
        throw new Error(`y-quorum: no lease on ${namespace}/${id}`)
      }
      return leaseOf(held)
    },

    leaseOf: async (namespace, id) => {
      const [held] = await query(
        `SELECT holder, address, epoch, until FROM ${t('leases')} WHERE namespace = $1 AND id = $2`,
        [namespace, id]
      )
      return held && leaseOf(held)
    },

    releaseLease: async (namespace, id, node) => {
      // Run out rather than removed: the epoch must keep growing, or a node that
      // held an old lease could match a new one
      await query(
        `UPDATE ${t('leases')} SET until = 0 WHERE namespace = $1 AND id = $2 AND holder = $3`,
        [namespace, id, node]
      )
    },

    delete: async (namespace, id) => {
      // The lease ended first, with the next epoch: a node still holding the
      // document writes nothing more to it
      // document writes nothing more to it. One statement, so nobody takes
      // the lease and writes between the two.
      const where = id !== undefined ? 'namespace = $1 AND id = $2' : 'namespace = $1'
      const deletes = tables.map((table, index) =>
        `d${index} AS (DELETE FROM ${t(table)} WHERE ${where})`)
      await query(
        `WITH fence AS (
          UPDATE ${t('leases')} SET holder = '', address = '', epoch = epoch + 1, until = 0
          WHERE ${where}
        ), ${deletes.join(', ')}
        SELECT 1`,
        id !== undefined ? [namespace, id] : [namespace]
      )
    }
  }
}

/** `VALUES` rows with numbered, typed parameters, from `$first` on */
function values(rows: Param[][], types: string[], first: number) {
  const params: Param[] = []
  const sql = rows.map((row) => `(${row.map((value, index) => {
    params.push(value)
    return `$${first + params.length - 1}::${types[index]}`
  }).join(', ')})`).join(', ')
  return { sql, params }
}

// Drivers differ: node-postgres gives bigints as strings and bytea as Buffers,
// PGlite numbers and Uint8Arrays. JSON is read as text, so a JSON string is
// never mistaken for JSON to parse.

function num(value: unknown): number {
  return Number(value)
}

function str(value: unknown): string {
  return String(value)
}

function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error('y-quorum: expected bytea')
  }
  return new Uint8Array(value)
}

function json<T>(value: unknown): T {
  return JSON.parse(str(value)) as T
}

function leaseOf(row: Row): Lease {
  return {
    holder: str(row.holder),
    address: str(row.address),
    epoch: num(row.epoch),
    until: num(row.until)
  }
}
