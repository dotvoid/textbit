// The history: who changed what and why, as a chain nobody can quietly
// rewrite. The owner folds the log's writes into entries, one actor,
// connection and layer at a time, and chains them with SHA-256: each entry's
// hash covers its fields, a hash of its change, and the hash before it. An
// export is JSON Lines that `verifyHistory` checks with nothing but itself.
import { createHash } from 'node:crypto'
import type { Layer } from '@dotvoid/y-quorum-client/protocol'
import type { Actor } from './types'

/** What a history entry did */
export type HistoryKind = 'edit' | 'restore' | 'review'

/** One entry of a document's history: writes of one actor, folded, in the chain */
export interface HistoryEntry {
  /** The document, `namespace/id` */
  doc: string
  /** Its place in the history, from 1 */
  seq: number
  /** The log positions of the writes it folds */
  from: number
  to: number
  layer: Layer
  /** When its first and last writes were stored */
  at: number
  until: number
  actor: Actor
  /** The connection the writes came over, when there was one */
  connection?: string
  kind: HistoryKind
  /** What it refers to, e.g. the version a restore restored */
  refs?: Record<string, string>
  /** The writes, merged into one Y.js update; may be removed later, the hash stays */
  payload?: Uint8Array
  /** SHA-256 of the payload, hex */
  payloadHash: string
  /** The hash of the entry before, or of nothing for the first */
  prevHash: string
  /** SHA-256 over the entry, hex */
  hash: string
}

/** The hash before the first entry */
export const GENESIS = '0'.repeat(64)

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** JSON with keys in order and nothing undefined: the same text for the same value, always */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${canonical(field)}`).join(',')}}`
}

/** The hash of an entry: its fields, the hash of its payload, and the hash before it */
export function hashOf(entry: Omit<HistoryEntry, 'hash' | 'payload'>): string {
  return sha256(canonical(entry))
}

/** An entry in the chain, after the one with `prevHash` */
export function seal(fields: Omit<HistoryEntry, 'hash' | 'payloadHash' | 'prevHash'>, prevHash: string): HistoryEntry {
  const { payload, ...rest } = fields
  const unsealed = { ...rest, payloadHash: sha256(payload ?? new Uint8Array()), prevHash }
  return { ...unsealed, ...(payload ? { payload } : {}), hash: hashOf(unsealed) }
}

/** An entry as a line of JSON, its payload base64 */
export function toJSONLine(entry: HistoryEntry): string {
  const { payload, ...rest } = entry
  return canonical({ ...rest, ...(payload ? { payload: Buffer.from(payload).toString('base64') } : {}) })
}

/** What checking an export found */
export type Verification =
  | { ok: true, entries: number, head: string }
  | { ok: false, entries: number, seq: number, reason: string }

/**
 * Checks an exported history: every payload against its hash, every entry
 * against its hash, every entry against the one before. Entries whose
 * payload was removed are checked by the hash they kept.
 */
export function verifyHistory(lines: string | string[]): Verification {
  const all = (Array.isArray(lines) ? lines : lines.split('\n')).filter((line) => line.trim())
  let prev = GENESIS
  let checked = 0
  for (const line of all) {
    const { payload, hash, ...rest } = JSON.parse(line) as Omit<HistoryEntry, 'payload'> & { payload?: string }
    const fail = (reason: string): Verification => ({ ok: false, entries: checked, seq: rest.seq, reason })
    if (rest.seq !== checked + 1) {
      return fail(`Entry ${checked + 1} is missing`)
    }
    if (rest.prevHash !== prev) {
      return fail('It does not follow the entry before')
    }
    if (payload !== undefined && sha256(Buffer.from(payload, 'base64')) !== rest.payloadHash) {
      return fail('Its change is not the one it was stored with')
    }
    if (hashOf(rest) !== hash) {
      return fail('It was changed after it was stored')
    }
    prev = hash
    checked++
  }
  return { ok: true, entries: checked, head: prev }
}
