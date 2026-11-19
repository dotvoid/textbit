import type * as Y from '@y/y'
import type { IncomingMessage } from 'node:http'
import type { Capabilities, DocumentRecord, Layer, Limits, Person, Principal, VersionInfo } from '@dotvoid/y-quorum-client/protocol'
import type { CommentThread, Path, TypeDefinition, Unreviewed } from '@dotvoid/y-quorum-client/model'
import type { HistoryEntry } from './history'

/** Who made a change: the principal, and whom it acted for */
export interface Actor {
  principal: Principal
  /** The person an agent or service acted for */
  onBehalfOf?: Principal
  /** The agent's run, when it says */
  run?: string
  /** The model, as the agent claims it: never verified */
  model?: string
}

/** What `authenticate` returns: who this is, and where they may go */
export interface Authenticated {
  principal: Principal
  /** The namespaces the principal may enter, or all */
  namespaces: string[] | '*'
  /** Whether agents may work through this connection, claiming to act for the principal. Default: `true` for people. */
  agents?: boolean
}

/** What the server asks a policy */
export interface PolicyContext {
  actor: Actor
  /** The principal's roles on this document, from `authorize` */
  roles: string[]
  layer: string
  /** The document's content as it is now */
  content: Y.Node
  /** For a write: the content as it would be after it */
  next?: Y.Node
  /** For a write: the paths it changes. Absent when asking what a connection may do in general. */
  paths?: Path[]
}

/**
 * Decides what may be done in a document. Pure and synchronous: the server
 * asks again for every open connection whenever the content changes, so a
 * document that becomes read-only is read-only for everyone at once.
 */
export type Policy = (context: PolicyContext) => Capabilities

/** A document type on the server: the shared definition, and the server's rules for it */
export interface ServerType extends TypeDefinition {
  policy?: Policy
}

/** One change in a document's log */
export interface LogEntry {
  seq: number
  at: number
  layer: Layer
  actor: Actor
  update: Uint8Array
}

/** What storage keeps of a document besides its log */
export interface StoredMeta {
  type: string
  incarnation: string
  createdAt: number
}

/** What a checkpoint keeps: the whole of a document at a log position */
export interface Checkpoint {
  /** The state of each layer */
  states: Partial<Record<Layer, Uint8Array>>
  /** For a type with history: who wrote what in each layer, Y.js ContentMaps encoded */
  attributions?: Partial<Record<Layer, Uint8Array>>
  /** The people the attributions name, by their key */
  people?: Record<string, Person>
  /** The content people have reviewed, a Y.js IdSet encoded */
  reviewed?: Uint8Array
}

/** A document as storage gives it back */
export interface StoredDocument {
  meta: StoredMeta
  /** The latest checkpoint, and the log position it is at */
  checkpoint?: Checkpoint & { seq: number }
  /** The log after the checkpoint */
  entries: LogEntry[]
  records: DocumentRecord[]
  /** For a type with history: its versions, oldest first, without their content */
  versions?: VersionInfo[]
  /** For a type with history: the last entry of its history, which the next one follows */
  historyHead?: { seq: number, hash: string }
}

/**
 * Where documents are kept. Small on purpose, so adapters are easy to write:
 * memory, SQLite and a host's own are included.
 */
export interface Storage {
  load(namespace: string, id: string): Promise<StoredDocument | undefined>
  /** Creates a document from its first checkpoint; fails when it exists */
  create(namespace: string, id: string, meta: StoredMeta, checkpoint: Checkpoint): Promise<void>
  append(namespace: string, id: string, entries: LogEntry[]): Promise<void>
  /** Keeps the whole of a document at a log position */
  checkpoint(namespace: string, id: string, checkpoint: Checkpoint, seq: number): Promise<void>
  appendRecord(namespace: string, id: string, record: DocumentRecord): Promise<void>
  /** The log, from a position on: who changed what, kept whole whatever was checkpointed */
  log(namespace: string, id: string, from?: number): Promise<LogEntry[]>
  /** Keeps a version: what it is, and the content's state at it */
  addVersion(namespace: string, id: string, version: VersionInfo, state: Uint8Array): Promise<void>
  /** Adds entries to a document's history, in order */
  appendHistory(namespace: string, id: string, entries: HistoryEntry[]): Promise<void>
  /** A document's history, after an entry on */
  history(namespace: string, id: string, from?: number): Promise<HistoryEntry[]>
  /** The content's state at a version */
  versionState(namespace: string, id: string, versionId: string): Promise<Uint8Array | undefined>
  /** Claims a Y.js client id for a principal; false when another principal holds it */
  claimClient(namespace: string, id: string, client: number, principal: string): Promise<boolean>
  /** Deletes a document, or a whole namespace */
  delete(namespace: string, id?: string): Promise<void>
  /** Called when a document is unloaded: a chance to store what was waiting */
  unloaded?(
    namespace: string,
    id: string,
    state: Uint8Array,
    json: Record<string, unknown>,
    type: string,
    comments: CommentThread[]
  ): Promise<void>
  close?(): Promise<void>
}

/** What `createServer` takes */
export interface ServerOptions {
  types: ServerType[]
  storage: Storage
  /** Who a token belongs to; nothing to refuse it */
  authenticate(token: string, request?: IncomingMessage): Promise<Authenticated | null> | Authenticated | null
  /**
   * The principal's roles on a document, e.g. `['editor']`; nothing when the
   * principal may not see it at all. Default: `['editor']` everywhere they may
   * enter.
   */
  authorize?(context: { principal: Principal, namespace: string, id: string, type: string }): Promise<string[] | null> | string[] | null
  /** Typed functions clients call */
  rpc?: Record<string, (args: unknown, context: { principal: Principal, server: QuorumServer }) => unknown>
  /** Called when a client saves: the content at a log position the client named */
  onSave?(event: {
    namespace: string
    id: string
    seq: number
    label?: string
    actor: Actor
    json: Record<string, unknown>
    /** For a type with history: the version the save made */
    version?: VersionInfo
  }): void | Promise<void>
  limits?: Partial<Limits>
  /** Milliseconds a document stays loaded after the last connection leaves. Default: 5000. */
  idle?: number
  /** Log entries between checkpoints. Default: 200. */
  checkpointEvery?: number
}

/** The server */
export interface QuorumServer {
  /** Serves WebSockets on an HTTP server's upgrades */
  attach(server: import('node:http').Server): void
  /** Starts an HTTP server of its own */
  listen(port: number): Promise<import('node:http').Server>
  /** Creates a document of a type, filled from JSON */
  create(namespace: string, id: string, type: string, initial?: Record<string, unknown>, actor?: Actor): Promise<void>
  /**
   * Changes a document from code in this process, as an actor, through the
   * same rules as everyone else. The change is made on a copy and sent
   * through the write pipeline; resolves to whether it was accepted.
   */
  transact(namespace: string, id: string, actor: Actor, change: (content: Y.Node) => void): Promise<boolean>
  /** A document's content as JSON */
  read(namespace: string, id: string): Promise<Record<string, unknown> | undefined>
  /** A document's comment threads, oldest first */
  comments(namespace: string, id: string): Promise<CommentThread[] | undefined>
  /** What agents wrote that is still in a document and no person has reviewed: for a publishing gate */
  unreviewed(namespace: string, id: string): Promise<Unreviewed[] | undefined>
  /**
   * A document's history as JSON Lines, every entry chained to the one before:
   * check it with `verifyHistory`
   */
  exportHistory(namespace: string, id: string): Promise<string>
  /** Appends a record from code in this process */
  appendRecord(namespace: string, id: string, actor: Actor, kind: string, data: unknown): Promise<DocumentRecord>
  /** Sends a host's message to every client that has the document open */
  send(namespace: string, id: string, message: unknown): void
  /** Deletes a document, or a namespace, everywhere it is kept */
  delete(namespace: string, id?: string): Promise<void>
  close(): Promise<void>
}
