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
  attributionsOf,
  pathOf,
  projection,
  readThreads,
  resolvePath,
  toJSON,
  type CommentThread,
  type Path
} from '@dotvoid/y-quorum-client/model'
import type { Actor, LogEntry, ServerOptions, ServerType, Storage, StoredDocument } from './types'
import { judgeComments } from './judgeComments'
import { GENESIS, seal, type HistoryKind } from './history'

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
  presence: { mode: 'watching' | 'reading' | 'editing', visible: boolean }
  /** Updates that arrived before what they depend on, waiting for it, in order */
  held: Array<{ header: Headers[typeof ToServer.UPDATE], update: Uint8Array }>
}

/** How much one opening may have waiting for what it depends on */
const HELD_UPDATES = 64
const HELD_BYTES = 4 * 1024 * 1024

/**
 * What judging a write found: refused, waiting, or allowed into a layer of
 * the log; `null` when it changes nothing, so there is nothing to store
 */
type Judgement = { code: ReasonCode, reason: string } | 'pending' | { layer: Layer | null }

const CONTENT = 'content'

/** The root each layer's Y.Doc keeps its data in */
const ROOTS: Record<Layer, string> = { content: CONTENT, comments: COMMENTS }

export class DocumentOwner {
  readonly openings = new Set<Opening>()
  /** The content */
  readonly doc: Y.Doc
  readonly awareness: awarenessProtocol.Awareness
  readonly records: DocumentRecord[]
  readonly incarnation: string
  /** Each layer a Y.Doc of its own, the content's being `doc` */
  private readonly layers: Map<Layer, Y.Doc>
  /** Copies the next write of each layer is tried on first */
  private shadows = new Map<Layer, Y.Doc>()
  /** For a type with history: who wrote what in each layer, as Y.js 14 keeps it */
  private attributions = new Map<Layer, Y.ContentMap>()
  /** The people the attributions name, by their key */
  private people: Record<string, Person> = {}
  /** For a type with history: its versions, oldest first */
  private versions: VersionInfo[]
  /** The writes being folded into the next history entry, and the last entry */
  private batch: Batch | undefined
  private historyHead: { seq: number, hash: string }
  private seq: number
  private recordSeq: number
  private sinceCheckpoint = 0
  private queue: Promise<unknown> = Promise.resolve()
  private projecting: ReturnType<typeof setTimeout> | undefined
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
    this.versions = stored.versions ?? []
    this.historyHead = stored.historyHead ?? { seq: 0, hash: GENESIS }
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
    return this.type.comments ? ['comments'] : []
  }

  get isIdle(): boolean {
    return this.openings.size === 0
  }

  /** Runs tasks of this document one at a time, in order */
  private serial<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private copy(layer: Layer = 'content'): Y.Doc {
    const copy = new Y.Doc()
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(this.layer(layer)))
    return copy
  }

  capabilitiesFor(principal: Principal, roles: string[]): Capabilities {
    const write = roles.some((role) => role === 'editor' || role === 'owner')
    const capabilities = this.type.policy
      ? this.type.policy({ actor: { principal }, roles, layer: CONTENT, content: this.root })
      : { read: roles.length > 0, write, records: write ? Object.keys(this.type.records ?? {}) : [] }
    // Comments only where the type has them; by role unless the policy says
    const comments = !this.type.comments
      ? 'none'
      : capabilities.comments ?? (write ? 'all' : roles.some((role) => role === 'commenter' || role === 'suggester') ? 'own' : 'none')
    // Versions by role unless the policy says: owners restore, editors make them
    const versions = !this.type.history || !capabilities.read
      ? undefined
      : capabilities.versions ?? (roles.includes('owner') ? 'restore' : capabilities.write ? 'create' : 'read')
    return { ...capabilities, comments, ...(versions ? { versions } : {}) }
  }

  // ---- Opening and closing ------------------------------------------------

  async open(opening: Opening, header: Headers[typeof ToServer.OPEN], vector: Uint8Array): Promise<void> {
    return this.serial(async () => {
      if (opening.mode === 'open' && header.clientId !== undefined) {
        const own = await this.storage.claimClient(this.namespace, this.id, header.clientId, opening.peer.principal.id)
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
        : await this.judge(opening.peer.principal.id, actor, opening.roles, header.layer, update)
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
    const log = await this.commit(actor!, judgement.layer, update, opening)
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
      const before = Y.encodeStateVector(copy)
      copy.transact(() => change(copy.get(CONTENT)))
      const update = Y.encodeStateAsUpdate(copy, before)
      // A client id of its own, claimed for the actor, as any writer's
      if (!(await this.storage.claimClient(this.namespace, this.id, copy.clientID, actor.principal.id))) {
        return false
      }
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

  // Whether a write to a layer may be applied, judged on that layer alone
  private async judge(principalId: string, actor: Actor, roles: string[], layer: Layer, update: Uint8Array): Promise<Judgement> {
    const doc = this.layer(layer)
    // 1. New content only under the writer's own client ids
    const known = Y.decodeStateVector(Y.encodeStateVector(doc))
    const clients = new Set<number>()
    for (const struct of Y.decodeUpdate(update).structs) {
      const { client, clock } = struct.id
      if (clock + struct.length > (known.get(client) ?? 0)) {
        clients.add(client)
      }
    }
    for (const client of clients) {
      if (!(await this.storage.claimClient(this.namespace, this.id, client, principalId))) {
        return { code: 'not-allowed', reason: 'The update writes under a client id held by someone else' }
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
      const rights = this.capabilitiesFor(actor.principal, roles).comments ?? 'none'
      const reason = judgeComments(doc.get(COMMENTS), root, changed, actor, rights)
      return reason ? refuse(reason) : { layer }
    }
    const paths = this.pathsOf(changed)
    const allowed = this.type.policy
      ? this.type.policy({ actor, roles, layer: CONTENT, content: this.root, next: root, paths }).write
      : roles.some((role) => role === 'editor' || role === 'owner')
    if (!allowed) {
      return refuse(paths.length ? `Not allowed to change ${paths.map((p) => p.join('.')).join(', ')}` : 'Not allowed to write here')
    }
    return { layer }
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
    await this.storage.append(this.namespace, this.id, [entry])
    this.seq = entry.seq
    if (this.type.history) {
      await this.fold(entry, from?.peer.id, kind, refs)
    }
    const attributed = this.apply(layer, update, actor, entry.at, from ?? this)
    for (const opening of this.openings) {
      if (opening !== from && opening.mode === 'open') {
        this.sendTo(opening, ToClient.UPDATE, { ref: opening.ref, layer }, update)
      }
    }
    // Who wrote it, to everyone with it open, the writer too
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
    // Only the content decides what people may do, and what watchers see
    if (layer === 'content') {
      this.afterChange()
    }
    if (++this.sinceCheckpoint >= (this.options.checkpointEvery ?? 200)) {
      await this.checkpoint()
    }
    this.settleSaves()
    return this.seq
  }

  private afterChange() {
    // What everyone may do, asked again: content decides it too
    for (const opening of this.openings) {
      const capabilities = this.capabilitiesFor(opening.peer.principal, opening.roles)
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
      ...(this.type.history ? { attributions: this.encodedAttributions((bytes) => bytes), people: this.people } : {})
    }, this.seq)
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
      if (!actor || !(opening.capabilities.records ?? []).includes(header.kind) || !this.type.records?.[header.kind]) {
        this.sendTo(opening, ToClient.REJECTED, { ref: opening.ref, seq: header.seq, code: 'not-allowed', reason: `Not allowed to record ${header.kind}` })
        return
      }
      await this.appendRecord(actor, header.kind, header.data)
      // Acknowledged like a change, so the client does not send it again
      this.sendTo(opening, ToClient.ACK, { ref: opening.ref, seq: header.seq, log: this.seq })
    })
  }

  async appendRecord(actor: Actor, kind: string, data: unknown): Promise<DocumentRecord> {
    const record: DocumentRecord = {
      seq: ++this.recordSeq,
      kind,
      at: Date.now(),
      actor: actor.principal,
      ...(actor.onBehalfOf ? { onBehalfOf: actor.onBehalfOf } : {}),
      data
    }
    await this.storage.appendRecord(this.namespace, this.id, record)
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
   * With history it is a version, made by whoever may make them.
   */
  save(opening: Opening, header: Headers[typeof ToServer.SAVE], vector: Uint8Array): void {
    if (this.type.history && !['create', 'restore'].includes(opening.capabilities.versions ?? '')) {
      this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: false, code: 'not-allowed', reason: 'Not allowed to make versions' })
      return
    }
    this.saves.push({ opening, call: header.call, vector: Y.decodeStateVector(vector), actor: { principal: opening.peer.principal }, ...(header.label ? { label: header.label } : {}) })
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
      void (async () => {
        const version = state
          ? await this.addVersion({ kind: 'saved', by: personOf(save.actor.principal), ...(save.label ? { label: save.label } : {}) }, seq, state)
          : undefined
        await this.options.onSave?.({
          namespace: this.namespace, id: this.id, seq, actor: save.actor, json,
          ...(save.label ? { label: save.label } : {}),
          ...(version ? { version } : {})
        })
        this.sendTo(save.opening, ToClient.SAVED, { ref: save.opening.ref, call: save.call, log: seq })
      })()
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
      actor: batch.actor, kind: batch.kind,
      ...(batch.connection ? { connection: batch.connection } : {}),
      ...(batch.refs ? { refs: batch.refs } : {}),
      payload: Y.mergeUpdates(batch.updates)
    }, this.historyHead.hash)
    this.historyHead = { seq: entry.seq, hash: entry.hash }
    await this.storage.appendHistory(this.namespace, this.id, [entry])
  }

  /** Keeps a version of the content at a log position, and tells everyone */
  private async addVersion(what: Pick<VersionInfo, 'kind' | 'by' | 'label'>, seq: number, state: Uint8Array): Promise<VersionInfo> {
    // A version cuts the history: what comes after it is another entry
    await this.flushHistory()
    const version: VersionInfo = { id: randomUUID(), seq, at: Date.now(), ...what }
    await this.storage.addVersion(this.namespace, this.id, version, state)
    this.versions.push(version)
    for (const opening of this.openings) {
      if (opening.mode === 'open') {
        this.sendTo(opening, ToClient.VERSIONS, { ref: opening.ref, versions: [version] })
      }
    }
    return version
  }

  /** A version's content, for showing or comparing: its state as the payload */
  version(opening: Opening, header: Headers[typeof ToServer.VERSION]): Promise<void> {
    return this.serial(async () => {
      const version = this.versions.find((candidate) => candidate.id === header.id)
      const state = version && opening.capabilities.versions
        ? await this.storage.versionState(this.namespace, this.id, version.id)
        : undefined
      if (!version || !state) {
        this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: false, code: 'not-found', reason: `No version ${header.id}` })
        return
      }
      this.sendTo(opening, ToClient.RESULT, { call: header.call, ok: true, value: version }, state)
    })
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
      this.sendTo(opening, ToClient.CLOSED, { ref: opening.ref, code, reason })
      this.close(opening)
    }
  }

  async unload(): Promise<void> {
    await this.serial(async () => {
      clearTimeout(this.projecting)
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
