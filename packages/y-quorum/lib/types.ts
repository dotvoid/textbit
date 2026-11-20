import type * as Y from '@y/y'
import type { IncomingMessage } from 'node:http'
import type { Capabilities, DocumentRecord, Layer, Limits, Person, Principal, VersionInfo } from '@dotvoid/y-quorum-client/protocol'
import type { CommentThread, Path, TypeDefinition, Unreviewed } from '@dotvoid/y-quorum-client/model'
import type { TBPluginDefinition } from '@dotvoid/textbit/headless'
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
  historyHead?: { seq: number, hash: string, /** The last log position it folds */ to: number }
}

/**
 * Where documents are kept. Small on purpose, so adapters are easy to write:
 * memory, SQLite and a host's own are included.
 */
export interface Storage {
  load(namespace: string, id: string): Promise<StoredDocument | undefined>
  /** Creates a document from its first checkpoint; fails when it exists */
  create(namespace: string, id: string, meta: StoredMeta, checkpoint: Checkpoint): Promise<void>
  /**
   * Adds writes to the log. With more than one node, `epoch` is the lease the
   * writing node holds: a store that keeps leases refuses a write from an older
   * one with a `StaleLease`, so a node that lost a document cannot write it.
   */
  append(namespace: string, id: string, entries: LogEntry[], epoch?: number): Promise<void>
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
  /**
   * Retention: drops what is older than `before` (milliseconds) and kept
   * elsewhere: the log's writes up to `upTo`, a checkpoint holding them, and
   * the history's payloads, whose hashes stay in the chain
   */
  prune?(namespace: string, id: string, limits: { before: number, upTo: number }): Promise<void>
  /**
   * The register of people a document's history names: their key, e.g.
   * `person:alice`, and who they are. Kept apart from the chain, which holds
   * keys only, so names can be looked after as the host decides.
   */
  addPeople?(namespace: string, id: string, people: Record<string, Person>): Promise<void>
  people?(namespace: string, id: string): Promise<Record<string, Person>>
  /** Who holds a client id, without claiming it: so ids are claimed only by writes that are taken */
  clientHolder?(namespace: string, id: string, client: number): Promise<string | undefined>
  /**
   * For more than one node: holds a document for a node, for `ttl` milliseconds,
   * unless another node holds it already. Answers who holds it now, where it is
   * reached, and the lease's epoch, which grows whenever it changes hands. A node
   * keeps a document by asking again before its lease runs out.
   */
  lease?(namespace: string, id: string, node: Node, ttl: number): Promise<Lease>
  /** Who holds a document now, without taking it: nothing when nobody ever has */
  leaseOf?(namespace: string, id: string): Promise<Lease | undefined>
  /** Lets a document go, for another node to take at once */
  releaseLease?(namespace: string, id: string, node: string): Promise<void>
  /**
   * Deletes a document, or a whole namespace. A storage that keeps leases ends
   * the lease first with the next epoch, so a node still holding the document
   * writes nothing more to it; leases themselves are never deleted.
   */
  delete(namespace: string, id?: string): Promise<void>
  /**
   * Called a while after a document's content or comments last changed, while
   * it is open: for a storage that keeps the document as JSON
   */
  settled?(
    namespace: string,
    id: string,
    json: Record<string, unknown>,
    type: string,
    comments: CommentThread[]
  ): Promise<void>
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

/** A server node, as other nodes reach it */
export interface Node {
  id: string
  /** Where other nodes reach it, e.g. `ws://10.0.0.5:1234` */
  address: string
}

/** Who holds a document */
export interface Lease {
  holder: string
  address: string
  epoch: number
  /** Milliseconds since the epoch at which it runs out */
  until: number
}

/** A write from a node whose lease on the document was taken over */
export class StaleLease extends Error {
  constructor(namespace: string, id: string) {
    super(`y-quorum: the lease on ${namespace}/${id} has passed to another node`)
    this.name = 'StaleLease'
  }
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
  /**
   * More than one node: this node, as the others reach it. With a storage that
   * keeps leases, each document is held by one node at a time, and the others
   * pass its frames on to it. Every node needs the same `nodeSecret`.
   */
  node?: Node
  /**
   * Signs the history's head at every checkpoint and version, for an audit:
   * with the signature in the chain, rewriting history takes the key, not only
   * access to the store. E.g. an Ed25519 key with `crypto.sign(null, message, key)`.
   */
  signer?: { keyId: string, sign(message: Uint8Array): Uint8Array | Promise<Uint8Array> }
  /** The secret the nodes share, to speak for clients to each other */
  nodeSecret?: string
  /** Milliseconds a lease lasts unless renewed; a dead node's documents move after it. Default: 10000. */
  leaseTtl?: number
  /** Milliseconds a document stays loaded after the last connection leaves. Default: 5000. */
  idle?: number
  /** Log entries between checkpoints. Default: 200. */
  checkpointEvery?: number
  /**
   * Milliseconds after the last change before a storage that keeps JSON (`host`)
   * is given an open document. Default: 2000.
   */
  settleAfter?: number
  /**
   * The plugins of text fields, by the name a field gives in `text({ plugins })`,
   * `default` for none: what repairs and checks of text fields go by. Give the
   * ones the editors have. Without, core's rules alone.
   */
  plugins?: Record<string, TBPluginDefinition[]>
  /** Milliseconds after a person's write before what it broke is repaired. Default: 100. */
  repairAfter?: number
}

/** The server */
export interface QuorumServer {
  /**
   * Serves WebSockets on an HTTP server's upgrades: those to `path` only, when
   * given, leaving the others to the server's other listeners; else all of them.
   * With more than one node, a node's address then includes the path.
   */
  attach(server: import('node:http').Server, options?: { path?: string }): void
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
  /**
   * Appends a record from code in this process, for an actor: checked as a
   * client's record is, by `authorize`, the policy and the type's record kinds
   */
  appendRecord(namespace: string, id: string, actor: Actor, kind: string, data: unknown): Promise<DocumentRecord>
  /** Sends a host's message to every client that has the document open */
  send(namespace: string, id: string, message: unknown): void
  /**
   * Retention: drops a document's changes older than `before` (milliseconds)
   * from the log and the history's payloads, keeping its checkpoint, its
   * versions and the history's chain of hashes. Time travel then reaches only
   * versions and the time after `before`.
   */
  prune(namespace: string, id: string, before: number): Promise<void>
  /** The people a document's history names, by their key */
  people(namespace: string, id: string): Promise<Record<string, Person>>
  /** Deletes a document, or a namespace, everywhere it is kept */
  delete(namespace: string, id?: string): Promise<void>
  close(): Promise<void>
}
