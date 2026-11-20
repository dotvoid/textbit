// One document, held by its owner: the only place its writes are judged,
// applied, logged and passed on. Writes are handled one at a time, in order.
//
// The write pipeline:
//   1. new content must come from a Y.js client id the writer has claimed;
//   2. the update is applied to a shadow copy first, which says what it
//      changes, as paths, and whether it can be integrated at all;
//   3. the policy decides on those paths;
//   4. accepted: appended to the log, applied, acknowledged, passed on, and
//      every connection's capabilities asked again; refused: the shadow is
//      rebuilt from the document and the writer told, with the update, so its
//      app can keep what was written.
import * as Y from '@y/y'
import { randomUUID } from 'node:crypto'
import * as awarenessProtocol from '@y/protocols/awareness'
import {
  ToClient,
  ToServer,
  encodeFrame,
  type ActorClaim,
  type Capabilities,
  type DocumentRecord,
  type Headers,
  type Layer,
  type Person,
  type VersionInfo,
  type Principal,
  type ReasonCode
} from '@dotvoid/y-quorum-client/protocol'
import {
  COMMENTS,
  actorKey,
  agentContent,
  attributionsOf,
  unreviewed,
  type Unreviewed,
  pathOf,
  projection,
  readThreads,
  resolvePath,
  toJSON,
  type CommentThread,
  type Path
} from '@dotvoid/y-quorum-client/model'
import { StaleLease, type Actor, type LogEntry, type ServerOptions, type ServerType, type Storage, type StoredDocument } from './types'
import { differsFromFork } from './suggestionActs'
import { judgeComments } from './judgeComments'
import { GENESIS, seal, signedHead, type HistoryActor, type HistoryKind } from './history'
import { REPAIRER, Repairs, checkWrite, repair } from './repairs'

/** The origin of the owner's repairs in its copies */
const REPAIRED = { yQuorum: 'repair' }
/** How often one text field may be repaired within a window before it is left alone */
const REPAIRS_PER_WINDOW = 20
const REPAIR_WINDOW = 60_000

/** How long writes of one actor are folded into one history entry at most */
const BATCH_MS = 10_000

/** Writes being folded into the next history entry */
interface Batch {
  key: string
  layer: Layer
  actor: Actor
  connection?: string
  kind: HistoryKind
  refs?: Record<string, string>
  from: number
  to: number
  at: number
  until: number
  updates: Uint8Array[]
  timer: ReturnType<typeof setTimeout>
}

/** A connection, as a document sees it */
export interface Peer {
  /** The connection's id, for the history */
  id: string
  principal: Principal
  /** Whether agents may claim to act for this principal through it */
  agents: boolean
  send(frame: Uint8Array): void
  /** Ends the connection as a passing interruption: its client reconnects and opens again */
  drop?(): void
  /** The owner ended one of its openings: the document was deleted, or may no longer be read */
  ended?(opening: Opening): void
}

/** One connection's opening of the document */
export interface Opening {
  peer: Peer
  ref: number
  mode: 'open' | 'watch'
  paths: string[]
  roles: string[]
  capabilities: Capabilities
  /** The awareness clients this opening speaks for */
  awarenessClients: Set<number>
  /** The projection last sent, as JSON, for watching */
  sent?: string
  /** For opening, not watching: watched documents are not in presence */
  presence: { mode: 'reading' | 'editing', visible: boolean }
  /** Updates that arrived before what they depend on, waiting for it, in order */
  held: Array<{ header: Headers[typeof ToServer.UPDATE], update: Uint8Array }>
  /**
   * What its last write to the suggestions wrote and deleted. Typing through
   * the suggestions view, not suggesting, Y.js writes it in the fork, then the
   * same items into the content: that is the person's own writing, not an accept.
   */
  echo?: { inserts: Y.IdSet, deletes: Y.IdSet }
}

/** How much one opening may have waiting for what it depends on */
const HELD_UPDATES = 64
const HELD_BYTES = 4 * 1024 * 1024
// Record ids remembered, so a record sent again after a lost acknowledgement is stored once
const RECORD_IDS = 1000

/**
 * What judging a write found: refused, waiting, or allowed into a layer of
 * the log; `null` when it changes nothing, so there is nothing to store
 */
type Judgement = { code: ReasonCode, reason: string } | 'pending' | { layer: Layer | null, kind?: HistoryKind, refs?: Record<string, string>, claims?: number[] }

const CONTENT = 'content'

/** Past states of the content kept for time travel */
const PAST_STATES = 8
/** Saves one opening may have waiting, and how long one waits */
const SAVES_WAITING = 16
const SAVE_TIMEOUT = 30000

/** The root each layer's Y.Doc keeps its data in: the suggestions fork the content's */
const ROOTS: Record<Layer, string> = { content: CONTENT, comments: COMMENTS, suggestions: CONTENT }

export class DocumentOwner {
  readonly openings = new Set<Opening>()
  /**
   * With more than one node: the lease this node holds the document by. Every
   * write carries it, so a node that lost the document writes nothing.
   */
  epoch?: number
  /** Called once when the document passes to another node */
  onLost?: () => void
  private lost = false
  private pastStates = new Map<number, Uint8Array>()
  private signedSeq = 0
  private checkpointTimer: ReturnType<typeof setTimeout> | undefined
  /** The content */
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  readonly records: DocumentRecord[]
  private recordIds = new Set<string>()
  readonly incarnation: string
  /** Each layer a Y.Doc of its own, the content's being `doc` */
  private readonly layers: Map<Layer, Y.Doc>
  /** Copies the next write of each layer is tried on first */
  private shadows = new Map<Layer, Y.Doc>()
  /** The client id each actor writes under from this process, by principal id */
  private transactClients = new Map<string, number>()
  /** What people's writes left to repair, and when it is next repaired */
  private repairs = new Repairs()
  private repairing: ReturnType<typeof setTimeout> | undefined
  /** Repairs of each text field lately, to stop rules that never settle */
  private repairCounts = new Map<string, { count: number, since: number }>()
  /** For a type with history: who wrote what in each layer, as Y.js 14 keeps it */
  private attributions = new Map<Layer, Y.ContentMap>()
  /** The people the attributions name, by their key */
  private people: Record<string, Person> = {}
  /** For a type with history: its versions, oldest first */
  private versions: VersionInfo[]
  /** The writes being folded into the next history entry, and the last entry */
  private batch: Batch | undefined
  private historyHead: { seq: number, hash: string, to: number }
  /** The content people have reviewed */
  private reviewed: Y.IdSet
  private seq: number
  private recordSeq: number
  private sinceCheckpoint = 0
  private queue: Promise<unknown> = Promise.resolve()
  private projecting: ReturnType<typeof setTimeout> | undefined
  /** For a storage that keeps JSON: when it is next given the document */
  private settling: ReturnType<typeof setTimeout> | undefined
  private saves: Array<{ opening: Opening, call: number, vector: Map<number, number>, actor: Actor, label?: string }> = []

  constructor(
    readonly namespace: string,
    readonly id: string,
    readonly type: ServerType,
    stored: StoredDocument,
    private readonly storage: Storage,
    private readonly options: ServerOptions,
    private readonly changed: (owner: DocumentOwner) => void
  ) {
    // With history, deleted content is kept: restoring a version brings it back
    this.doc = new Y.Doc({ gc: !type.history })
    this.layers = new Map<Layer, Y.Doc>([['content', this.doc], ['comments', new Y.Doc()]])
    if (type.suggestions) {
      // A fork of the content: it keeps what it deletes, to show it struck
      this.layers.set('suggestions', new Y.Doc({ gc: false, isSuggestionDoc: true }))
    }
    this.versions = stored.versions ?? []
    this.historyHead = stored.historyHead ?? { seq: 0, hash: GENESIS, to: 0 }
    this.reviewed = stored.checkpoint?.reviewed ? Y.decodeIdSet(stored.checkpoint.reviewed) : Y.createIdSet()
    for (const [layer, doc] of this.layers) {
      const state = stored.checkpoint?.states[layer]
      if (state) {
        Y.applyUpdate(doc, state)
      }
      const attributions = stored.checkpoint?.attributions?.[layer]
      if (attributions && type.history) {
        this.attributions.set(layer, Y.decodeContentMap(attributions))
      }
    }
    this.people = { ...stored.checkpoint?.people }
    // The log after the checkpoint, attributed again as it is applied
    for (const entry of stored.entries) {
      if (this.layers.has(entry.layer)) {
        this.apply(entry.layer, entry.update, entry.actor, entry.at)
      }
    }
    this.seq = stored.entries.length ? stored.entries[stored.entries.length - 1].seq : stored.checkpoint?.seq ?? 0
    this.records = stored.records
    this.recordSeq = stored.records.length ? stored.records[stored.records.length - 1].seq : 0
    this.incarnation = stored.meta.incarnation
    for (const layer of this.layers.keys()) {
      this.shadows.set(layer, this.copy(layer))
    }
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null)
    this.awareness.on('update', this.relayAwareness)
  }

  get root(): Y.Node {
    return this.doc.get(CONTENT)
  }

  /** The content as JSON */
  json(): Record<string, unknown> {
    return toJSON(this.root, this.type.content)
  }

  /** The comment threads, oldest first */
  comments(): CommentThread[] {
    return readThreads(this.layer('comments').get(COMMENTS))
  }

  private layer(layer: Layer): Y.Doc {
    return this.layers.get(layer)!
  }

  /**
   * Applies a write to a layer and, for a type with history, attributes what
   * it inserted and deleted to its actor: the attributions of the change
   */
  private apply(layer: Layer, update: Uint8Array, actor: Actor, at: number, origin?: unknown): Y.ContentMap | undefined {
    const doc = this.layer(layer)
    let sets: { inserts: Y.IdSet, deletes: Y.IdSet } | undefined
    const capture = (transaction: { insertSet: Y.IdSet, deleteSet: Y.IdSet }) => {
      sets = { inserts: transaction.insertSet, deletes: transaction.deleteSet }
    }
    doc.on('afterTransaction', capture)
    try {
      Y.applyUpdate(doc, update, origin)
    } finally {
      doc.off('afterTransaction', capture)
    }
    // The content flows into its fork, always
    const fork = this.layers.get('suggestions')
    if (layer === 'content' && fork) {
      Y.applyUpdate(fork, update, origin)
    }
    if (!this.type.history || !sets) {
      return undefined
    }
    const by = personOf(actor.principal)
    const onBehalfOf = actor.onBehalfOf ? personOf(actor.onBehalfOf) : undefined
    const change = attributionsOf(sets.inserts, sets.deletes, {
      by, at, ...(onBehalfOf ? { onBehalfOf } : {}), ...(actor.run ? { run: actor.run } : {})
    })
    this.attributions.set(layer, Y.mergeContentMaps([this.attributions.get(layer) ?? Y.createContentMap(), change]))
    for (const person of [by, onBehalfOf]) {
      if (person) {
        this.people[actorKey(person)] = person
      }
    }
    return change
  }

  /** Who wrote what in each layer, encoded */
  private encodedAttributions<T>(as: (bytes: Uint8Array) => T): Partial<Record<Layer, T>> {
    const out: Partial<Record<Layer, T>> = {}
    for (const [layer, attributions] of this.attributions) {
      out[layer] = as(Y.encodeContentMap(attributions))
    }
    return out
  }

  /** The layers a client of this type keeps beside the content */
  private get extraLayers(): Layer[] {
    return [
      ...(this.type.comments ? ['comments' as const] : []),
      ...(this.type.suggestions ? ['suggestions' as const] : [])
    ]
  }

  get isIdle(): boolean {
    return this.openings.size === 0
  }

  /** Runs tasks of this document one at a time, in order */
  private serial<T>(task: () => Promise<T> | T): Promise<T> {
    // A document passed to another node does nothing more here
    const guarded = () => (this.lost ? Promise.reject(new StaleLease(this.namespace, this.id)) : task())
    const run = this.queue.then(guarded, guarded)
    this.queue = run.catch(() => undefined)
    return run
  }

  private copy(layer: Layer = 'content'): Y.Doc {
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(this.layer(layer)))
    return copy
  }

  /**
   * What an actor may do here: the policy's answer, or the roles'. The actor
   * whole, so a policy sees whom an agent acts for.
   */
  capabilitiesFor(actor: Actor, roles: string[]): Capabilities {
    const write = roles.some((role) => role === 'editor' || role === 'owner')
    const capabilities = this.type.policy
      ? this.type.policy({ actor, roles, layer: CONTENT, content: this.root })
      : { read: roles.length > 0, write, records: write ? Object.keys(this.type.records ?? {}) : [] }
    // Comments only where the type has them; unless the policy says, whoever
    // may write comments on all, and a commenter or suggester on their own. A
    // document that became read-only takes commenting on all from editors too
    const commenter = roles.some((role) => role === 'commenter' || role === 'suggester')
    const comments = !this.type.comments
      ? 'none'
      : capabilities.comments ??
        (capabilities.write ? 'all' : commenter && capabilities.read ? 'own' : 'none')
    // Suggestions by role unless the policy says: editors accept and reject
    const suggestions = !this.type.suggestions
      ? undefined
      : capabilities.suggestions ?? (capabilities.write ? 'all' : roles.includes('suggester') ? 'own' : 'none')
    // Versions by role unless the policy says: owners restore, editors make them
    const versions = !this.type.history || !capabilities.read
      ? undefined
      : capabilities.versions ?? (roles.includes('owner') ? 'restore' : capabilities.write ? 'create' : 'read')
    return { ...capabilities, comments, ...(versions ? { versions } : {}), ...(suggestions ? { suggestions } : {}) }
  }

  // ---- Opening and closing ------------------------------------------------

  async open(opening: Opening, header: Headers[typeof ToServer.OPEN], vector: Uint8Array): Promise<void> {
    return this.serial(async () => {
      if (opening.mode === 'open' && header.clientId !== undefined) {
        // Anyone who may write claims their id now, before anyone who saw it in
        // awareness could write under it first; a reader's is only checked, so
        // reading fills no claims
        const caps = opening.capabilities
        const writes = caps.write || (caps.comments ?? 'none') !== 'none' || (caps.suggestions ?? 'none') !== 'none'
        const own = writes
          ? await this.storage.claimClient(this.namespace, this.id, header.clientId, opening.peer.principal.id)
          : await this.holderOf(header.clientId, opening.peer.principal.id) !== 'other'
        if (!own) {
          this.sendTo(opening, ToClient.CLOSED, { ref: opening.ref, code: 'client-id-taken', reason: 'That client id writes for someone else; pick another' })
          return
        }
      }
      this.openings.add(opening)
      if (opening.mode === 'watch') {
        const value = projection(this.root, this.type.content, opening.paths)
        opening.sent = JSON.stringify(value)
        this.sendTo(opening, ToClient.OPENED, {
          ref: opening.ref, type: this.type.name, incarnation: this.incarnation,
          capabilities: opening.capabilities, seq: this.seq, projection: value
        })
      } else {
        const known = header.incarnation === undefined || header.incarnation === this.incarnation
        const missing = Y.encodeStateAsUpdate(this.doc, known && vector.length ? vector : undefined)
        // The other layers in the header: their state vectors, and what the client lacks
        const layers: Headers[typeof ToClient.OPENED]['layers'] = {}
        for (const layer of this.extraLayers) {
          const doc = this.layer(layer)
          const theirs = known ? header.layers?.[layer] : undefined
          layers[layer] = {
            stateVector: toBase64(Y.encodeStateVector(doc)),
            missing: toBase64(Y.encodeStateAsUpdate(doc, theirs ? fromBase64(theirs) : undefined))
          }
        }
        this.sendTo(opening, ToClient.OPENED, {
          ref: opening.ref, type: this.type.name, incarnation: this.incarnation,
          capabilities: opening.capabilities, seq: this.seq,
          stateVector: toBase64(Y.encodeStateVector(this.doc)),
          records: this.records,
          ...(this.extraLayers.length ? { layers } : {}),
          ...(this.type.history ? { attributions: this.encodedAttributions(toBase64), people: this.people, versions: this.versions } : {})
        }, missing)
        const present = [...this.awareness.getStates().keys()]
        if (present.length) {
          this.sendTo(opening, ToClient.AWARENESS, { ref: opening.ref }, awarenessProtocol.encodeAwarenessUpdate(this.awareness, present))
        }
      }
      this.changed(this)
    })
  }

  close(opening: Opening): void {
    if (!this.openings.delete(opening)) {
      return
    }
    if (opening.awarenessClients.size) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [...opening.awarenessClients], null)
    }
    this.saves = this.saves.filter((save) => save.opening !== opening)
    opening.held.length = 0
    this.changed(this)
  }

  // ---- Writes ---------------------------------------------------------------

  update(opening: Opening, header: Headers[typeof ToServer.UPDATE], update: Uint8Array): Promise<void> {
    return this.serial(async () => {
      const outcome = await this.write(opening, header, update)
      if (outcome === 'pending') {
        this.hold(opening, header, update)
        return
      }
      if (outcome === 'committed') {
        await this.retryHeld()
      }
    })
  }

  // Judges one update of an opening and acts on it: committed and acknowledged,
  // acknowledged as changing nothing, refused with a reason, or found to
  // depend on something not here yet
  private async write(
    opening: Opening,
    header: Headers[typeof ToServer.UPDATE],
    update: Uint8Array
  ): Promise<'committed' | 'unchanged' | 'refused' | 'pending'> {
    const actor = this.actorOf(opening, header.claim)
    const judgement: Judgement = !actor
      ? { code: 'not-allowed', reason: 'Agents may not act for this principal' }
      : header.layer !== 'content' && !this.extraLayers.includes(header.layer)
        ? { code: 'invalid', reason: `This document has no layer ${String(header.layer)}` }
        : await this.judge(opening.peer.principal.id, actor, opening.roles, header.layer, update, opening)
    if (judgement === 'pending') {
      return 'pending'
    }
    if ('code' in judgement) {
      this.sendTo(opening, ToClient.REJECTED, { ref: opening.ref, seq: header.seq, code: judgement.code, reason: judgement.reason }, update)
      return 'refused'
    }
    if (judgement.layer === null) {
      this.sendTo(opening, ToClient.ACK, { ref: opening.ref, seq: header.seq, log: this.seq })
      return 'unchanged'
    }
    // Taken: now its new client ids are its writer's
    for (const client of judgement.claims ?? []) {
      if (!(await this.storage.claimClient(this.namespace, this.id, client, opening.peer.principal.id))) {
        this.shadows.set(judgement.layer, this.copy(judgement.layer))
        this.sendTo(opening, ToClient.REJECTED, { ref: opening.ref, seq: header.seq, code: 'not-allowed', reason: 'The update writes under a client id held by someone else' }, update)
        return 'refused'
      }
    }
    const log = await this.commit(actor!, judgement.layer, update, opening, judgement.kind, judgement.refs)
    if (judgement.layer === 'suggestions') {
      const { inserts, deletes } = Y.createContentIdsFromUpdate(update)
      opening.echo = { inserts, deletes }
    } else if (judgement.layer === 'content') {
      opening.echo = undefined
    }
    this.sendTo(opening, ToClient.ACK, { ref: opening.ref, seq: header.seq, log })
    return 'committed'
  }

  // An update that arrived before what it depends on waits for it; the only
  // way that happens is a client's own frames out of order, so its own later
  // frames bring what is missing. Too much waiting is refused.
  private hold(opening: Opening, header: Headers[typeof ToServer.UPDATE], update: Uint8Array) {
    opening.held.push({ header, update })
    const bytes = opening.held.reduce((sum, held) => sum + held.update.length, 0)
    if (opening.held.length <= HELD_UPDATES && bytes <= HELD_BYTES) {
      return
    }
    for (const held of opening.held.splice(0)) {
      this.sendTo(opening, ToClient.REJECTED, {
        ref: opening.ref,
        seq: held.header.seq,
        code: 'conflict',
        reason: 'Too much waiting for changes the server does not have'
      }, held.update)
    }
  }

  // After a change, what was waiting may fit: tried again in order until
  // nothing more does
  private async retryHeld() {
    let progress = true
    while (progress) {
      progress = false
      for (const opening of this.openings) {
        for (const held of [...opening.held]) {
          const outcome = await this.write(opening, held.header, held.update)
          if (outcome !== 'pending') {
            opening.held.splice(opening.held.indexOf(held), 1)
            progress ||= outcome === 'committed'
          }
        }
      }
    }
  }

  /** Changes the document from this process, as an actor, through the same rules */
  transact(actor: Actor, roles: string[], change: (content: Y.Node) => void): Promise<boolean> {
    return this.serial(async () => {
      const copy = this.copy()
      if (!(await this.writeAs(actor, copy))) {
        return false
      }
      const before = Y.encodeStateVector(copy)
      copy.transact(() => change(copy.get(CONTENT)))
      const update = Y.encodeStateAsUpdate(copy, before)
      const judgement = await this.judge(actor.principal.id, actor, roles, 'content', update)
      if (judgement === 'pending' || 'code' in judgement) {
        return false
      }
      if (judgement.layer === null) {
        return true
      }
      await this.commit(actor, judgement.layer, update)
      await this.retryHeld()
      return true
    })
  }

  /**
   * A copy written in this process takes the client id its actor writes under
   * here: claimed once, as any writer's, and kept for its later changes, so
   * they do not fill the claims. False when the id is someone else's.
   */
  private async writeAs(actor: Actor, copy: Y.Doc): Promise<boolean> {
    const held = this.transactClients.get(actor.principal.id)
    if (held !== undefined) {
      copy.clientID = held
      return true
    }
    const { namespace, id } = this
    if (!(await this.storage.claimClient(namespace, id, copy.clientID, actor.principal.id))) {
      return false
    }
    this.transactClients.set(actor.principal.id, copy.clientID)
    return true
  }

  // Whether a write to a layer may be applied, judged on that layer alone
  private async judge(
    principalId: string,
    actor: Actor,
    roles: string[],
    layer: Layer,
    update: Uint8Array,
    from?: Opening
  ): Promise<Judgement> {
    const doc = this.layer(layer)
    // 1. New content only under the writer's own client ids, but for what is
    //    suggested in the fork: accepting a suggestion, or recording that it
    //    was rejected, writes the suggester's very items into the content
    const ids = Y.createContentIdsFromUpdate(update)
    const fresh = Y.diffIdSet(ids.inserts, Y.createInsertSetFromStructStore(doc.store, false))
    const fork = layer === 'content' ? this.layers.get('suggestions') : undefined
    const suggested = fork ? Y.intersectSets(fresh, Y.createInsertSetFromStructStore(fork.store, false)) : Y.createIdSet()
    // ...and only when they are the fork's very items, not new content under their ids
    if (fork && !suggested.isEmpty()) {
      const forged = differsFromFork(update, fork, suggested)
      if (forged) {
        return { code: 'not-allowed', reason: `Not a suggestion as it was made: ${forged}` }
      }
    }
    const clients = new Set(Y.diffIdSet(fresh, suggested).clients.keys())
    const claims: number[] = []
    for (const client of clients) {
      const holder = await this.holderOf(client, principalId)
      if (holder === 'other') {
        return { code: 'not-allowed', reason: 'The update writes under a client id held by someone else' }
      }
      if (holder === 'free') {
        claims.push(client)
      }
    }
    // 2. On the shadow first: what it changes, and whether it fits at all
    const shadow = this.shadows.get(layer)!
    let changed: Map<Y.Node, Set<string | null>> | undefined
    const capture = (transaction: { changed: Map<Y.Node, Set<string | null>> }) => {
      changed = transaction.changed
    }
    shadow.on('afterTransaction', capture)
    try {
      Y.applyUpdate(shadow, update)
    } finally {
      shadow.off('afterTransaction', capture)
    }
    const reset = () => this.shadows.set(layer, this.copy(layer))
    // Y.js keeps what it cannot integrate yet: structs whose dependencies are
    // missing, and deletions of content it does not have
    const store = (shadow as unknown as { store: { pendingStructs: unknown, pendingDs: unknown } }).store
    if (store.pendingStructs || store.pendingDs) {
      reset()
      return 'pending'
    }
    const refuse = (reason: string): Judgement => {
      reset()
      return { code: 'not-allowed', reason }
    }
    // A client that reopens sends what the server may lack, and Y.js always
    // includes every deletion it knows of: nothing new is a change to nobody
    if (!changed?.size) {
      return { layer: null }
    }
    // 3. Only the layer's own root, judged by the layer's rules: comments by
    //    who wrote what, the content by the policy on the paths it changes
    const root = shadow.get(ROOTS[layer])
    for (const node of changed.keys()) {
      let top = node
      while (top.parent) {
        top = top.parent
      }
      if (top !== root) {
        return refuse(`Changes only the ${layer}`)
      }
    }
    if (layer === 'comments') {
      const rights = this.capabilitiesFor(actor, roles).comments ?? 'none'
      const reason = judgeComments(doc.get(COMMENTS), root, changed, actor, rights)
      return reason ? refuse(reason) : { layer, claims }
    }
    if (layer === 'suggestions') {
      const reason = await this.judgeSuggestion(principalId, actor, roles, update)
      return reason ? refuse(reason) : { layer, claims }
    }
    let kind: HistoryKind | undefined
    let acceptedDeletes = Y.createIdSet()
    // The writer's own, just written in the fork through the suggestions view,
    // by someone who may write the content: their writing, not an accept. An
    // editor accepting their own suggestion at once reads as writing too.
    const echo = from && this.capabilitiesFor(actor, roles).write ? from.echo : undefined
    const typed = (set: Y.IdSet, own: Y.IdSet | undefined) =>
      own !== undefined && !set.isEmpty() && Y.diffIdSet(set, own).isEmpty()
    if (!suggested.isEmpty() && !typed(suggested, echo?.inserts)) {
      const rights = this.capabilitiesFor(actor, roles).suggestions ?? 'none'
      // Written and deleted at once, nothing else: a record that they were
      // rejected, which changes nothing anyone sees
      const rejected = Y.diffIdSet(fresh, suggested).isEmpty() &&
        Y.diffIdSet(suggested, ids.deletes).isEmpty() &&
        Y.diffIdSet(ids.deletes, suggested).isEmpty()
      if (rejected) {
        // A rejection changes nothing anyone sees: written deleted, a
        // suggested value must not replace the one in the content either
        if (JSON.stringify(toJSON(root, this.type.content)) !== JSON.stringify(this.json())) {
          return refuse('A rejection may not change the content')
        }
        if (rights === 'all') {
          return { layer, kind: 'reject', refs: this.suggestedBy(suggested, Y.createIdSet()), claims }
        }
        for (const client of suggested.clients.keys()) {
          if (rights !== 'own' || await this.holderOf(client, principalId) !== 'mine') {
            return refuse('Only its author, or an editor, withdraws a suggestion')
          }
        }
        return { layer, kind: 'reject', refs: this.suggestedBy(suggested, Y.createIdSet()), claims }
      }
      if (rights !== 'all') {
        return refuse('Only an editor accepts a suggestion')
      }
      kind = 'accept'
    } else if (fork) {
      // Deleting what a suggestion deletes, by whoever may accept: accepting it
      const suggestedDeletes = Y.diffIdSet(
        Y.createDeleteSetFromStructStore(fork.store),
        Y.createDeleteSetFromStructStore(doc.store)
      )
      const accepted = Y.intersectSets(ids.deletes, suggestedDeletes)
      if (!accepted.isEmpty() && !typed(accepted, echo?.deletes) &&
        this.capabilitiesFor(actor, roles).suggestions === 'all') {
        kind = 'accept'
        acceptedDeletes = accepted
      }
    }
    const paths = this.pathsOf(changed)
    const allowed = this.type.policy
      ? this.type.policy({ actor, roles, layer: CONTENT, content: this.root, next: root, paths }).write
      : roles.some((role) => role === 'editor' || role === 'owner')
    if (!allowed) {
      return refuse(paths.length ? `Not allowed to change ${paths.map((p) => p.join('.')).join(', ')}` : 'Not allowed to write here')
    }
    // A person's write is repaired afterwards, never refused for its shape;
    // an agent's or code's is checked first
    if (actor.principal.kind === 'person') {
      this.repairs.note(this.root, root, this.type.content, paths)
    } else {
      const wrong = checkWrite(this.root, root, this.type.content, paths, this.options.plugins)
      if (wrong) {
        reset()
        return { code: 'invalid', reason: wrong }
      }
    }
    return kind ? { layer, kind, refs: this.suggestedBy(suggested, acceptedDeletes), claims } : { layer, claims }
  }

  /**
   * Whether a write to the fork may be stored. Anything suggested is a
   * suggestion, the deletion of content included. Deleting what exists only
   * in the fork withdraws or rejects a suggestion: only its author, or
   * whoever may accept and reject, does that.
   */
  private async judgeSuggestion(principalId: string, actor: Actor, roles: string[], update: Uint8Array): Promise<string | undefined> {
    const rights = this.capabilitiesFor(actor, roles).suggestions ?? 'none'
    if (rights === 'none') {
      return 'Not allowed to suggest here'
    }
    if (rights === 'all') {
      return undefined
    }
    const content = Y.createInsertSetFromStructStore(this.doc.store, false)
    const withdrawn = Y.diffIdSet(Y.createContentIdsFromUpdate(update).deletes, content)
    for (const client of withdrawn.clients.keys()) {
      // The writer of a suggestion holds its client id
      if (await this.holderOf(client, principalId) !== 'mine') {
        return 'Only its author, or an editor, withdraws a suggestion'
      }
    }
    return undefined
  }

  private checkpointSoon() {
    if (this.checkpointTimer) {
      return
    }
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = undefined
      void this.serial(() => this.checkpoint()).catch(() => undefined)
    }, 1000)
  }

  /**
   * The document has passed to another node: everyone here is sent off to
   * reconnect, and to find it where it is now. Nothing more is written.
   */
  giveUp(): void {
    if (this.lost) {
      return
    }
    this.lost = true
    clearTimeout(this.batch?.timer)
    clearTimeout(this.checkpointTimer)
    clearTimeout(this.settling)
    clearTimeout(this.repairing)
    clearTimeout(this.projecting)
    for (const opening of [...this.openings]) {
      this.openings.delete(opening)
      opening.peer.drop?.()
    }
    this.awareness.destroy()
    this.onLost?.()
  }

  get isLost(): boolean {
    return this.lost
  }

  // Whose a client id is: the principal's, nobody's yet, or someone else's
  private async holderOf(client: number, principal: string): Promise<'mine' | 'free' | 'other'> {
    if (this.storage.clientHolder) {
      const holder = await this.storage.clientHolder(this.namespace, this.id, client)
      return holder === undefined ? 'free' : holder === principal ? 'mine' : 'other'
    }
    // A store that cannot only look claims as it checks
    return (await this.storage.claimClient(this.namespace, this.id, client, principal)) ? 'mine' : 'other'
  }

  // Who suggested what an accept or a rejection takes: both stay on record,
  // the suggester here and whoever decided as the entry's actor
  private suggestedBy(inserts: Y.IdSet, deletes: Y.IdSet): Record<string, string> {
    const map = this.attributions.get('suggestions')
    const keys = new Set<string>()
    const collect = (ids: Y.IdMap<unknown>, within: Y.IdSet, verb: 'insert' | 'delete') => {
      const outside = Y.diffIdSet(Y.createIdSetFromIdMap(ids), within)
      Y.diffIdMap(ids, outside).forEach((range: { attrs: Array<{ name: string, val: unknown }> }) => {
        const who = range.attrs.find((attr) => attr.name === verb)?.val
        if (typeof who === 'string') {
          keys.add(who)
        }
      })
    }
    if (map) {
      collect(map.inserts, inserts, 'insert')
      collect(map.deletes, deletes, 'delete')
    }
    return keys.size ? { suggestedBy: [...keys].sort().join(',') } : {}
  }

  private pathsOf(changed: Map<Y.Node, Set<string | null>>): Path[] {
    const root = this.shadows.get('content')!.get(CONTENT)
    const found = new Map<string, Path>()
    for (const [node, keys] of changed) {
      const base = node === root ? [] : pathOf(node, root, this.type.content)
      if (!base) {
        continue
      }
      const at = resolvePath(root, this.type.content, base)
      for (const key of keys) {
        const path = key !== null && at?.field.kind === 'object' ? [...base, key] : base
        found.set(path.join('\u0000'), path)
      }
    }
    return [...found.values()]
  }

  // Accepted: logged, applied, passed on
  private async commit(
    actor: Actor,
    layer: Layer,
    update: Uint8Array,
    from?: Opening,
    kind: HistoryKind = 'edit',
    refs?: Record<string, string>
  ): Promise<number> {
    const entry: LogEntry = { seq: this.seq + 1, at: Date.now(), layer, actor, update }
    try {
      await this.storage.append(this.namespace, this.id, [entry], this.epoch)
    } catch (error) {
      if (error instanceof StaleLease) {
        this.giveUp()
      }
      // Not stored: the shadows forget it, so the same update sent again is
      // judged again, not taken for one already here
      this.resetShadows()
      throw error
    }
    try {
      return await this.committed(entry, from, kind, refs)
    } catch (error) {
      // Stored, but not here as it should be: let go, and whoever loads the
      // document next has it from the log
      this.giveUp()
      throw error
    }
  }

  private resetShadows() {
    for (const layer of [...this.shadows.keys()]) {
      this.shadows.set(layer, this.copy(layer))
    }
  }

  // Stored: folded into history, applied and passed on
  private async committed(
    entry: LogEntry,
    from: Opening | undefined,
    kind: HistoryKind,
    refs: Record<string, string> | undefined
  ): Promise<number> {
    const { layer, actor, update } = entry
    this.seq = entry.seq
    if (this.type.history) {
      await this.fold(entry, from?.peer.id, kind, refs)
    }
    const attributed = this.apply(layer, update, actor, entry.at, from ?? this)
    // The fork's shadow follows the content as the fork does, so a suggestion
    // on content just written can be judged
    const forkShadow = this.shadows.get('suggestions')
    if (layer === 'content' && forkShadow) {
      Y.applyUpdate(forkShadow, update)
    }
    // Who wrote it, to everyone with it open, the writer too: before the
    // change, so what shows it can attribute it as it arrives
    if (attributed) {
      const payload = Y.encodeContentMap(attributed)
      const people = Object.fromEntries([actor.principal, actor.onBehalfOf]
        .filter((who) => who !== undefined)
        .map((who) => [actorKey(who), personOf(who)]))
      for (const opening of this.openings) {
        if (opening.mode === 'open') {
          this.sendTo(opening, ToClient.ATTRIBUTIONS, { ref: opening.ref, layer, people }, payload)
        }
      }
    }
    for (const opening of this.openings) {
      if (opening !== from && opening.mode === 'open') {
        this.sendTo(opening, ToClient.UPDATE, { ref: opening.ref, layer, log: this.seq }, update)
      }
    }
    // Only the content decides what people may do, and what watchers see
    if (layer === 'content') {
      this.afterChange()
    }
    if (++this.sinceCheckpoint >= (this.options.checkpointEvery ?? 200)) {
      await this.checkpoint()
    }
    if (layer === 'content' || layer === 'comments') {
      this.settleSoon()
    }
    if (layer === 'content' && actor.principal !== REPAIRER && !this.repairs.isEmpty) {
      this.repairSoon()
    }
    this.settleSaves()
    return this.seq
  }

  /** What people's writes broke is repaired a moment later, once what is arriving with it has */
  private repairSoon() {
    clearTimeout(this.repairing)
    this.repairing = setTimeout(() => {
      this.repairing = undefined
      void this.serial(() => this.repairNow()).catch(() => undefined)
    }, this.options.repairAfter ?? 100)
    this.repairing.unref?.()
  }

  /**
   * Repairs what people's writes left, on a copy, and stores the repair as one
   * change of the server's own. Only here, by the document's one owner: two
   * clients repairing the same thing at once would duplicate or delete it.
   */
  private async repairNow() {
    clearTimeout(this.repairing)
    this.repairing = undefined
    if (this.repairs.isEmpty) {
      return
    }
    const work = this.repairs.take()
    // A field repaired again and again has rules that never settle: left alone a while
    const now = Date.now()
    work.text = work.text.filter((path) => {
      const key = path.join('\u0000')
      const recent = this.repairCounts.get(key)
      const counted = recent && now - recent.since < REPAIR_WINDOW
        ? recent
        : { count: 0, since: now }
      this.repairCounts.set(key, { ...counted, count: counted.count + 1 })
      return counted.count < REPAIRS_PER_WINDOW
    })
    const copy = this.copy()
    const actor: Actor = { principal: REPAIRER }
    if (!(await this.writeAs(actor, copy))) {
      return
    }
    // What the repair itself wrote and deleted, nothing else: an update from
    // a state vector carries every deletion the document has ever had
    const inserts: Y.IdSet[] = []
    const deletes: Y.IdSet[] = []
    const collect = (tr: Y.Transaction) => {
      inserts.push(tr.insertSet)
      deletes.push(tr.deleteSet)
    }
    const before = Y.encodeStateVector(copy)
    copy.on('afterTransaction', collect)
    try {
      repair(copy.get(CONTENT), this.type.content, work, this.options.plugins, REPAIRED)
    } finally {
      copy.off('afterTransaction', collect)
    }
    const own = Y.createContentIds(Y.mergeIdSets(inserts), Y.mergeIdSets(deletes))
    if (own.inserts.isEmpty() && own.deletes.isEmpty()) {
      return
    }
    const update = Y.intersectUpdateWithContentIds(Y.encodeStateAsUpdate(copy, before), own)
    // Not judged: the owner's own, on what it has. The shadow follows it.
    Y.applyUpdate(this.shadows.get('content')!, update)
    await this.commit(actor, 'content', update, undefined, 'repair')
  }

  /** A storage that keeps JSON is given the document a while after it last changed */
  private settleSoon() {
    if (!this.storage.settled) {
      return
    }
    clearTimeout(this.settling)
    this.settling = setTimeout(() => {
      this.settling = undefined
      void this.serial(() => this.storage.settled?.(
        this.namespace, this.id, this.json(), this.type.name, this.comments()
      )).catch(() => undefined)
    }, this.options.settleAfter ?? 2000)
    this.settling.unref?.()
  }

  private afterChange() {
    // What everyone may do, asked again: content decides it too
    for (const opening of [...this.openings]) {
      const { principal } = opening.peer
      const capabilities = this.capabilitiesFor({ principal }, opening.roles)
      if (!capabilities.read) {
        // Nothing more of it, as when a fresh token takes reading away
        this.end(opening, 'not-allowed', 'No longer allowed to read this document')
        continue
      }
      if (JSON.stringify(capabilities) !== JSON.stringify(opening.capabilities)) {
        opening.capabilities = capabilities
        this.sendTo(opening, ToClient.POLICY, { ref: opening.ref, seq: this.seq, capabilities })
      }
    }
    // Watchers, a moment later and only what changed
    clearTimeout(this.projecting)
    this.projecting = setTimeout(() => {
      for (const opening of this.openings) {
        if (opening.mode !== 'watch') {
          continue
        }
        const value = projection(this.root, this.type.content, opening.paths)
        const json = JSON.stringify(value)
        if (json !== opening.sent) {
          opening.sent = json
          this.sendTo(opening, ToClient.PROJECTION, { ref: opening.ref, projection: value })
        }
      }
    }, 100)
  }

  async checkpoint(): Promise<void> {
    this.sinceCheckpoint = 0
    const states: Partial<Record<Layer, Uint8Array>> = {}
    for (const [layer, doc] of this.layers) {
      states[layer] = Y.encodeStateAsUpdate(doc)
    }
    await this.storage.checkpoint(this.namespace, this.id, {
      states,
      ...(this.type.history
        ? { attributions: this.encodedAttributions((bytes) => bytes), people: this.people, reviewed: Y.encodeIdSet(this.reviewed) }
        : {})
    }, this.seq)
    await this.signHead()
  }

  /**
   * An actor as the chain holds it: by key. Whoever it names goes into the
   * register first, with the name they have now, so the chain never names
   * someone the register does not know.
   */
  private async keyed(actor: Actor): Promise<HistoryActor> {
    const fresh: Record<string, Person> = {}
    for (const who of [actor.principal, actor.onBehalfOf]) {
      if (who) {
        const key = actorKey(who)
        const person: Person = { kind: who.kind, id: who.id, name: who.name }
        if (this.people[key]?.name !== person.name) {
          this.people[key] = person
          fresh[key] = person
        }
      }
    }
    if (Object.keys(fresh).length) {
      await this.storage.addPeople?.(this.namespace, this.id, fresh)
    }
    return {
      by: actorKey(actor.principal),
      ...(actor.onBehalfOf ? { onBehalfOf: actorKey(actor.onBehalfOf) } : {}),
      ...(actor.run ? { run: actor.run } : {}),
      ...(actor.model ? { model: actor.model } : {})
    }
  }

  /** The register of people the history names */
  register(): Record<string, Person> {
    return { ...this.people }
  }

  /** Retention: what is older than `before` goes, the chain of hashes and the versions stay */
  prune(before: number): Promise<void> {
    return this.serial(async () => {
      if (!this.storage.prune) {
        return
      }
      // Everything sealed and checkpointed first: nothing pruned is needed to load
      await this.flushHistory()
      await this.checkpoint()
      await this.storage.prune(this.namespace, this.id, { before, upTo: this.seq })
      this.pastStates.clear()
    })
  }

  /** Signs the history's head into the chain, when the server has a signer and it is not signed yet */
  private async signHead() {
    const signer = this.options.signer
    if (!signer || !this.type.history) {
      return
    }
    await this.flushHistory()
    const head = this.historyHead
    if (head.seq === 0 || head.seq === this.signedSeq) {
      return
    }
    const signature = await signer.sign(signedHead(`${this.namespace}/${this.id}`, head.seq, head.hash))
    await this.sealAside('signature', { principal: { kind: 'service', id: 'server', name: 'Server' } }, undefined,
      { keyId: signer.keyId, signs: String(head.seq), head: head.hash }, signature)
    this.signedSeq = this.historyHead.seq
  }

  // Who an update is from: the connection's principal, or an agent claiming to act for it
  private actorOf(opening: Opening, claim: ActorClaim | undefined): Actor | undefined {
    const principal = opening.peer.principal
    if (!claim) {
      return { principal }
    }
    if (!opening.peer.agents) {
      return undefined
    }
    return {
      principal: { kind: 'agent', id: claim.agent, name: claim.name ?? claim.agent },
      onBehalfOf: principal,
      ...(claim.run ? { run: claim.run } : {}),
      ...(claim.model ? { model: claim.model } : {})
    }
  }

  // ---- Presence, records, saves, messages -----------------------------------

  awarenessFrom(opening: Opening, update: Uint8Array): void {
    // Everyone appears as who the server knows them to be
    const principal = opening.peer.principal
    const stamped = awarenessProtocol.modifyAwarenessUpdate(update, (state: Record<string, unknown> | null) =>
      state === null ? state : { ...state, principal: { kind: principal.kind, id: principal.id, name: principal.name } })
    awarenessProtocol.applyAwarenessUpdate(this.awareness, stamped, opening)
  }

  private relayAwareness = ({ added, updated, removed }: { added: number[], updated: number[], removed: number[] }, origin: unknown) => {
    const from = origin as Opening | null
    if (from && this.openings.has(from)) {
      added.forEach((client) => from.awarenessClients.add(client))
      removed.forEach((client) => from.awarenessClients.delete(client))
    }
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed])
    for (const opening of this.openings) {
      if (opening !== from && opening.mode === 'open') {
        this.sendTo(opening, ToClient.AWARENESS, { ref: opening.ref }, update)
      }
    }
  }

  record(opening: Opening, header: Headers[typeof ToServer.RECORD]): Promise<void> {
    return this.serial(async () => {
      const actor = this.actorOf(opening, header.claim)
      // An agent's record by what the policy lets the agent do
      const capabilities = actor && header.claim
        ? this.capabilitiesFor(actor, opening.roles)
        : opening.capabilities
      if (!actor || !this.mayRecord(capabilities, header.kind)) {
        this.sendTo(opening, ToClient.REJECTED, { ref: opening.ref, seq: header.seq, code: 'not-allowed', reason: `Not allowed to record ${header.kind}` })
        return
      }
      // Sent again when its acknowledgement was lost: stored once
      if (header.id === undefined || !this.recordIds.has(header.id)) {
        await this.appendRecord(actor, header.kind, header.data, opening.peer.id)
        this.rememberRecord(header.id)
      }
      // Acknowledged like a change, so the client does not send it again
      this.sendTo(opening, ToClient.ACK, { ref: opening.ref, seq: header.seq, log: this.seq })
    })
  }

  // The ids of records lately stored, the oldest forgotten first
  private rememberRecord(id: string | undefined) {
    if (id === undefined) {
      return
    }
    this.recordIds.add(id)
    if (this.recordIds.size > RECORD_IDS) {
      this.recordIds.delete(this.recordIds.values().next().value!)
    }
  }

  /** Whether a record of this kind may be appended, by what an actor may do */
  mayRecord(capabilities: Capabilities, kind: string): boolean {
    return Boolean(this.type.records?.[kind]) && (capabilities.records ?? []).includes(kind)
  }

  /** A record from code in the server process: checked as a client's is */
  recordFrom(actor: Actor, roles: string[], kind: string, data: unknown): Promise<DocumentRecord> {
    return this.serial(async () => {
      if (!this.mayRecord(this.capabilitiesFor(actor, roles), kind)) {
        throw new Error(`y-quorum: not allowed to record ${kind} in ${this.namespace}/${this.id}`)
      }
      return this.appendRecord(actor, kind, data)
    })
  }

  async appendRecord(actor: Actor, kind: string, data: unknown, connection?: string): Promise<DocumentRecord> {
    const record: DocumentRecord = {
      seq: ++this.recordSeq,
      kind,
      at: Date.now(),
      actor: actor.principal,
      ...(actor.onBehalfOf ? { onBehalfOf: actor.onBehalfOf } : {}),
      data
    }
    await this.storage.appendRecord(this.namespace, this.id, record)
    if (this.type.history) {
      // A record is part of the history too: in the chain, beside the writes
      await this.sealAside('record', actor, connection, { record: String(record.seq), kind },
        // In the chain by key, as everyone in it: names are in the register
        new TextEncoder().encode(JSON.stringify({
          ...record,
          actor: actorKey(record.actor),
          ...(record.onBehalfOf ? { onBehalfOf: actorKey(record.onBehalfOf) } : {})
        })))
    }
    this.records.push(record)
    for (const opening of this.openings) {
      if (opening.mode === 'open') {
        this.sendTo(opening, ToClient.RECORDS, { ref: opening.ref, records: [record] })
      }
    }
    return record
  }

  /**
   * A save: answered once the document holds everything the client had.
   * With history it is a version, made by whoever may make them; without, it
   * is made by whoever may write.
   */
  save(opening: Opening, header: Headers[typeof ToServer.SAVE], vector: Uint8Array): void {
    const { versions, write } = opening.capabilities
    const may = this.type.history ? versions === 'create' || versions === 'restore' : write
    if (!may) {
      const reason = this.type.history ? 'Not allowed to make versions' : 'Not allowed to save'
      this.sendTo(opening, ToClient.RESULT,
        { call: header.call, ok: false, code: 'not-allowed', reason })
      return
    }
    if (this.saves.filter((save) => save.opening === opening).length >= SAVES_WAITING) {
      this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: false, code: 'over-limit', reason: 'Too many saves waiting' })
      return
    }
    const save = { opening, call: header.call, vector: Y.decodeStateVector(vector), actor: { principal: opening.peer.principal }, ...(header.label ? { label: header.label } : {}) }
    this.saves.push(save)
    // A save waiting for what never comes is let go, and the client told
    setTimeout(() => {
      if (this.saves.includes(save)) {
        this.saves.splice(this.saves.indexOf(save), 1)
        this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: false, code: 'unavailable', reason: 'What the save waited for never arrived' })
      }
    }, SAVE_TIMEOUT).unref?.()
    void this.serial(() => this.settleSaves())
  }

  private settleSaves() {
    const have = Y.decodeStateVector(Y.encodeStateVector(this.doc))
    const waiting = this.saves
    this.saves = []
    for (const save of waiting) {
      const complete = [...save.vector].every(([client, clock]) => (have.get(client) ?? 0) >= clock)
      if (!complete) {
        this.saves.push(save)
        continue
      }
      // The state now, at this log position, whatever arrives while it is stored
      const seq = this.seq
      const json = this.json()
      const state = this.type.history ? Y.encodeStateAsUpdate(this.doc) : undefined
      void this.serial(async () => {
        // Saving what is already a version makes no new one: versions grow
        // only with the document, however often someone saves
        const latest = this.versions[this.versions.length - 1]
        const version = !state
          ? undefined
          : latest && latest.seq === seq && !save.label
            ? latest
            : await this.addVersion({ kind: 'saved', by: personOf(save.actor.principal), ...(save.label ? { label: save.label } : {}) }, seq, state)
        await this.options.onSave?.({
          namespace: this.namespace, id: this.id, seq, actor: save.actor, json,
          ...(save.label ? { label: save.label } : {}),
          ...(version ? { version } : {})
        })
        this.sendTo(save.opening, ToClient.SAVED, { ref: save.opening.ref, call: save.call, log: seq })
      })
    }
  }

  /**
   * Folds a write into the history: into the open entry when it is the same
   * actor, connection, layer and run within a few seconds, else into a new
   * one. A restore is an entry of its own.
   */
  private async fold(entry: LogEntry, connection: string | undefined, kind: HistoryKind, refs?: Record<string, string>) {
    const { actor } = entry
    const key = JSON.stringify([entry.layer, actor.principal, actor.onBehalfOf ?? null, actor.run ?? null, connection ?? null, kind])
    const open = this.batch
    if (open && (open.key !== key || kind !== 'edit' || entry.at - open.at > BATCH_MS)) {
      await this.flushHistory()
    }
    if (this.batch) {
      this.batch.to = entry.seq
      this.batch.until = entry.at
      this.batch.updates.push(entry.update)
    } else {
      this.batch = {
        key, layer: entry.layer, actor, kind, from: entry.seq, to: entry.seq, at: entry.at, until: entry.at,
        updates: [entry.update],
        ...(connection ? { connection } : {}),
        ...(refs ? { refs } : {}),
        // Written once the time is up, even when nothing follows
        timer: setTimeout(() => void this.serial(() => this.flushHistory()), BATCH_MS)
      }
    }
    if (kind !== 'edit') {
      await this.flushHistory()
    }
  }

  /** Seals the open history entry now, in turn with the document's other work */
  flushHistoryNow(): Promise<void> {
    return this.serial(() => this.flushHistory())
  }

  /** Seals the open history entry into the chain and stores it */
  async flushHistory(): Promise<void> {
    const batch = this.batch
    if (!batch) {
      return
    }
    this.batch = undefined
    clearTimeout(batch.timer)
    const entry = seal({
      doc: `${this.namespace}/${this.id}`,
      seq: this.historyHead.seq + 1,
      from: batch.from, to: batch.to, layer: batch.layer, at: batch.at, until: batch.until,
      actor: await this.keyed(batch.actor), kind: batch.kind,
      ...(batch.connection ? { connection: batch.connection } : {}),
      ...(batch.refs ? { refs: batch.refs } : {}),
      payload: Y.mergeUpdates(batch.updates)
    }, this.historyHead.hash)
    // The head moves once the entry is stored: a failed write leaves the
    // chain as it was, and the log's writes are folded again on the next load
    await this.storage.appendHistory(this.namespace, this.id, [entry])
    this.historyHead = { seq: entry.seq, hash: entry.hash, to: entry.to }
  }

  /**
   * Folds into the history what the log holds beyond it: the writes of a
   * process that stopped before it sealed them. Their kind was not kept, so
   * they enter the chain as edits, marked as recovered.
   */
  async recover(): Promise<void> {
    if (!this.type.history) {
      return
    }
    await this.serial(async () => {
      // The register as it is now, beside what the checkpoint knew
      Object.assign(this.people, await this.storage.people?.(this.namespace, this.id))
      for (const entry of await this.storage.log(this.namespace, this.id, this.historyHead.to)) {
        await this.fold(entry, undefined, 'edit', { recovered: 'true' })
      }
      await this.flushHistory()
    })
  }

  /**
   * An entry of the history beside the writes, taking no log position: a
   * review, a record. Sealed after what is being folded, at the position
   * reached.
   */
  private async sealAside(kind: HistoryKind, actor: Actor, connection: string | undefined, refs: Record<string, string>, payload: Uint8Array) {
    await this.flushHistory()
    const at = Date.now()
    const entry = seal({
      doc: `${this.namespace}/${this.id}`, seq: this.historyHead.seq + 1,
      from: this.historyHead.to, to: this.historyHead.to, layer: 'content', at, until: at,
      actor: await this.keyed(actor), ...(connection ? { connection } : {}), kind, refs, payload
    }, this.historyHead.hash)
    await this.storage.appendHistory(this.namespace, this.id, [entry])
    this.historyHead = { seq: entry.seq, hash: entry.hash, to: entry.to }
  }

  /** Keeps a version of the content at a log position, and tells everyone */
  private async addVersion(what: Pick<VersionInfo, 'kind' | 'by' | 'label'>, seq: number, state: Uint8Array): Promise<VersionInfo> {
    // A version cuts the history: what comes after it is another entry
    await this.flushHistory()
    const version: VersionInfo = { id: randomUUID(), seq, at: Date.now(), ...what }
    await this.storage.addVersion(this.namespace, this.id, version, state)
    this.versions.push(version)
    await this.signHead()
    for (const opening of this.openings) {
      if (opening.mode === 'open') {
        this.sendTo(opening, ToClient.VERSIONS, { ref: opening.ref, versions: [version] })
      }
    }
    return version
  }

  /**
   * A version's content, or the content at a log position, for showing or
   * comparing: its state as the payload
   */
  version(opening: Opening, header: Headers[typeof ToServer.VERSION]): Promise<void> {
    return this.serial(async () => {
      const notFound = (reason: string) =>
        this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: false, code: 'not-found', reason })
      if (!opening.capabilities.versions) {
        return notFound('This document keeps no versions')
      }
      if (header.seq !== undefined) {
        const state = await this.contentAt(header.seq)
        return state
          ? this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: true, value: { seq: header.seq } }, state)
          : notFound(`Nothing kept from before log position ${header.seq}`)
      }
      const version = this.versions.find((candidate) => candidate.id === header.id)
      const state = version && await this.storage.versionState(this.namespace, this.id, version.id)
      if (!version || !state) {
        return notFound(`No version ${header.id}`)
      }
      this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: true, value: version }, state)
    })
  }

  /**
   * The content as it was at a log position: the latest version at or before
   * it, and the content's writes after that up to it
   */
  private async contentAt(seq: number): Promise<Uint8Array | undefined> {
    const target = Math.min(Math.max(0, seq), this.seq)
    // The last few asked for are kept: scrubbing back and forth replays nothing twice
    const kept = this.pastStates.get(target)
    if (kept) {
      this.pastStates.delete(target)
      this.pastStates.set(target, kept)
      return kept
    }
    const state = await this.replayTo(target)
    if (state) {
      this.pastStates.set(target, state)
      while (this.pastStates.size > PAST_STATES) {
        this.pastStates.delete(this.pastStates.keys().next().value!)
      }
    }
    return state
  }

  private async replayTo(target: number): Promise<Uint8Array | undefined> {
    const base = [...this.versions].reverse().find((version) => version.seq <= target)
    const state = base && await this.storage.versionState(this.namespace, this.id, base.id)
    if (!base || !state) {
      return undefined
    }
    const doc = new Y.Doc({ gc: false })
    Y.applyUpdate(doc, state)
    let next = base.seq + 1
    for (const entry of await this.storage.log(this.namespace, this.id, base.seq)) {
      if (entry.seq > target) {
        break
      }
      // Retention may have taken what lies between: no past is shown wrong
      if (entry.seq !== next++) {
        return undefined
      }
      if (entry.layer === 'content') {
        Y.applyUpdate(doc, entry.update)
      }
    }
    if (next <= target) {
      return undefined
    }
    return Y.encodeStateAsUpdate(doc)
  }

  /**
   * Restores a version as a new change, the way Y.js 14 reverts: what was
   * inserted since is deleted and what was deleted since comes back, in the
   * name of whoever restores it. A version is made first, so the restore can
   * be undone by restoring that.
   */
  restore(opening: Opening, header: Headers[typeof ToServer.RESTORE]): Promise<void> {
    return this.serial(async () => {
      const fail = (code: ReasonCode, reason: string) => {
        this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: false, code, reason })
      }
      if (opening.capabilities.versions !== 'restore') {
        return fail('not-allowed', 'Not allowed to restore versions')
      }
      const version = this.versions.find((candidate) => candidate.id === header.id)
      const state = version && await this.storage.versionState(this.namespace, this.id, version.id)
      if (!version || !state) {
        return fail('not-found', `No version ${header.id}`)
      }
      const then = new Y.Doc({ gc: false })
      Y.applyUpdate(then, state)
      const now = new Y.Doc({ gc: false })
      Y.applyUpdate(now, Y.encodeStateAsUpdate(this.doc))
      const before = Y.encodeStateVector(now)
      Y.undoContentIds(now, Y.createContentIdsFromDocDiff(now, then))
      const update = Y.encodeStateAsUpdate(now, before)

      const actor: Actor = { principal: opening.peer.principal }
      if (!(await this.storage.claimClient(this.namespace, this.id, now.clientID, actor.principal.id))) {
        return fail('conflict', 'Could not write the restore')
      }
      const judgement = await this.judge(actor.principal.id, actor, opening.roles, 'content', update)
      if (judgement === 'pending' || 'code' in judgement) {
        return fail(judgement === 'pending' ? 'conflict' : judgement.code, judgement === 'pending' ? 'Could not write the restore' : judgement.reason)
      }
      const backup = await this.addVersion({
        kind: 'before-restore',
        by: personOf(actor.principal),
        label: `Before restoring ${version.label ?? 'a version'}`
      }, this.seq, Y.encodeStateAsUpdate(this.doc))
      const log = judgement.layer
        ? await this.commit(actor, judgement.layer, update, undefined, 'restore', { restored: version.id, backup: backup.id })
        : this.seq
      await this.retryHeld()
      this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: true, value: { log, backup } })
    })
  }

  /** What agents wrote that is still in the text and nobody has reviewed */
  unreviewed(): Unreviewed[] {
    return unreviewed(this.attributions.get('content') ?? Y.createContentMap(), this.reviewed)
  }

  /**
   * A person reviewed what agents wrote, one run's or all of it, as it is
   * now: an act of its own in the history, never inferred from reading or
   * editing nearby. What agents write after it is not covered.
   */
  review(opening: Opening, header: Headers[typeof ToServer.REVIEW]): Promise<void> {
    return this.serial(async () => {
      const principal = opening.peer.principal
      if (!this.type.history || principal.kind !== 'person' || !opening.capabilities.write) {
        this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: false, code: 'not-allowed', reason: 'Only a person who may edit reviews' })
        return
      }
      const ids = agentContent(this.attributions.get('content') ?? Y.createContentMap(), header.run !== undefined ? { run: header.run } : {})
      this.reviewed = Y.mergeIdSets([this.reviewed, ids])
      await this.sealAside('review', { principal }, opening.peer.id,
        header.run !== undefined ? { run: header.run } : { scope: 'agents' }, Y.encodeIdSet(ids))
      // Kept soon: a review must not be lost to a crash, and many reviews in a
      // row share one checkpoint
      this.checkpointSoon()
      this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: true, value: { unreviewed: this.unreviewed() } })
    })
  }

  /**
   * New roles for an opening, after its token was renewed: what it may do is
   * worked out again, and sent when it changed. False when it may no longer read.
   */
  reauthorize(opening: Opening, roles: string[]): boolean {
    const capabilities = this.capabilitiesFor({ principal: opening.peer.principal }, roles)
    if (!capabilities.read) {
      return false
    }
    opening.roles = roles
    if (JSON.stringify(capabilities) !== JSON.stringify(opening.capabilities)) {
      opening.capabilities = capabilities
      this.sendTo(opening, ToClient.POLICY, { ref: opening.ref, seq: this.seq, capabilities })
    }
    return true
  }

  setMode(opening: Opening, mode: 'reading' | 'editing', visible: boolean): void {
    opening.presence = { mode, visible }
    this.changed(this)
  }

  message(message: unknown): void {
    for (const opening of this.openings) {
      this.sendTo(opening, ToClient.MESSAGE, { ref: opening.ref, message })
    }
  }

  /** Ends every opening, e.g. when the document is deleted */
  closeAll(code: ReasonCode, reason: string): void {
    for (const opening of [...this.openings]) {
      this.end(opening, code, reason)
    }
  }

  // Ends an opening from here: its client is told, and its connection forgets it
  private end(opening: Opening, code: ReasonCode, reason: string) {
    this.sendTo(opening, ToClient.CLOSED, { ref: opening.ref, code, reason })
    this.close(opening)
    opening.peer.ended?.(opening)
  }

  async unload(): Promise<void> {
    await this.serial(async () => {
      clearTimeout(this.projecting)
      // Unloading gives the storage the document anyway, and checkpoints it
      clearTimeout(this.settling)
      this.settling = undefined
      clearTimeout(this.checkpointTimer)
      this.checkpointTimer = undefined
      // What waits for repair is repaired now, not left for whoever loads it next
      await this.repairNow()
      await this.flushHistory()
      await this.checkpoint()
      await this.storage.unloaded?.(this.namespace, this.id, Y.encodeStateAsUpdate(this.doc), this.json(), this.type.name, this.comments())
      this.awareness.destroy()
    })
  }

  private sendTo<T extends keyof Headers>(opening: Opening, type: T, header: Headers[T], payload?: Uint8Array) {
    opening.peer.send(encodeFrame(type, header, payload))
  }
}

/** Who someone is in attributions: no more than their kind, id and name */
function personOf(principal: Principal): Person {
  return { kind: principal.kind, id: principal.id, name: principal.name }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64'))
}
