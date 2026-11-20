// The y-quorum wire protocol, shared by the client and the server.
//
// One WebSocket carries any number of documents. Every frame is binary:
//
//   varuint   frame type
//   varstring header, as JSON
//   varbytes  payload: a Y.js update, a state vector or an awareness update;
//             empty when the frame has none
//
// Documents are addressed by `ref`, a number the client chooses when it opens
// one, so frames stay short. A client can open the same document only once at a
// time: every view of it in the page shares that one opening.
//
// A document is a Y.Doc per layer: `content`, and beside it `comments` and
// `suggestions` for a type that has them. Suggestions are a fork of the
// content, as in Y.js 14: the content flows into it, and what is suggested
// stays there until it is accepted into the content. Only the content travels in payloads of OPEN and OPENED;
// the other layers' state vectors and missing updates go in the header, base64.
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

/** The version of this protocol. A client speaking another is told to reload. */
export const PROTOCOL_VERSION = 1

/** A document's layers, each a Y.Doc of its own */
export type Layer = 'content' | 'comments' | 'suggestions'

/** Frames a client sends */
export const ToServer = {
  /** First frame: who this is */
  HELLO: 1,
  /** Open a document, or watch some of its fields; payload: the client's state vector */
  OPEN: 2,
  /** Close a document the client opened */
  CLOSE: 3,
  /** A change to a document; payload: the Y.js update */
  UPDATE: 4,
  /** Presence in a document; payload: an awareness update */
  AWARENESS: 5,
  /** Append a record to a document */
  RECORD: 6,
  /** Call a host's function */
  RPC: 7,
  /** A fresh token, without reconnecting */
  TOKEN: 8,
  /** Keep the connection alive; also answers the server's ping */
  PING: 9,
  /** What the person is doing in an open document: reading or editing */
  MODE: 10,
  /** Follow who has which documents open in a namespace */
  PRESENCE: 11,
  /** Save: the client's state vector; the server answers once it holds all of it. With history, a version. */
  SAVE: 12,
  /** A version's content, for showing it or comparing; answered with RESULT, the state as payload */
  VERSION: 13,
  /** Restore a version, as a new change; answered with RESULT */
  RESTORE: 14,
  /** A person reviewed what agents wrote: one run's, or all of it; answered with RESULT */
  REVIEW: 15,
  /** What agents wrote that nobody has reviewed; answered with RESULT */
  UNREVIEWED: 16,
  /** From another node only: a host's message for those with a document open there */
  NODE_MESSAGE: 17
} as const

/** Frames a server sends */
export const ToClient = {
  /** The answer to HELLO: who the server takes the client to be, and the limits */
  WELCOME: 101,
  /** The connection is refused or closed, with a reason */
  REFUSED: 102,
  /** A document is open; payload: what the client is missing */
  OPENED: 103,
  /** A document was closed by the server */
  CLOSED: 104,
  /** Someone else's change; payload: the Y.js update */
  UPDATE: 105,
  /** A change of the client's is stored */
  ACK: 106,
  /** A change of the client's is refused; payload: the refused update */
  REJECTED: 107,
  /** Others' presence; payload: an awareness update */
  AWARENESS: 108,
  /** The watched fields, as JSON */
  PROJECTION: 109,
  /** Records appended to a document */
  RECORDS: 110,
  /** What the client may now do in a document, from a position in its log on */
  POLICY: 111,
  /** Who has which documents open in a namespace */
  PRESENCE: 112,
  /** A message from the host to a document's clients */
  MESSAGE: 113,
  /** The result of an RPC */
  RESULT: 114,
  /** The answer to PING */
  PONG: 115,
  /** A save is done: the version holding everything the client had */
  SAVED: 116,
  /** Who wrote what in a change just stored; payload: a Y.js ContentMap */
  ATTRIBUTIONS: 117,
  /** Versions just made */
  VERSIONS: 118
} as const

/** Why something was refused, in a fixed place: `header.code` */
export type ReasonCode =
  | 'unauthenticated'
  | 'not-allowed'
  | 'not-found'
  | 'gone'
  | 'over-limit'
  | 'stale-protocol'
  | 'invalid'
  | 'conflict'
  | 'client-id-taken'
  | 'unavailable'

/** What a person or program is, as the server decided at authentication */
export interface Principal {
  kind: 'person' | 'agent' | 'service'
  id: string
  name: string
  /** e.g. a colour, for presence */
  [extra: string]: unknown
}

/** Someone in a document's attributions */
export interface Person {
  kind: 'person' | 'agent' | 'service'
  id: string
  name: string
}

/** A version of a document's content: its state at a position in the log */
export interface VersionInfo {
  id: string
  /** The log position it is at */
  seq: number
  /** When it was made */
  at: number
  /** Who made it */
  by: Person
  label?: string
  /** Made with the document, saved by someone, or made by the server before a restore */
  kind: 'created' | 'saved' | 'before-restore'
}

/** What an agent working through a person's connection says about itself */
export interface ActorClaim {
  agent: string
  name?: string
  run?: string
  model?: string
}

/**
 * What someone may do with comments: nothing; open threads, reply, and edit,
 * delete and resolve their own; or also resolve and delete anyone's. Nobody
 * edits someone else's words.
 */
export type CommentRights = 'none' | 'own' | 'all'

/** What may be done in a document, as the server's policy decided */
export interface Capabilities {
  read: boolean
  write: boolean
  /** Record kinds this connection may append */
  records?: string[]
  /** What this connection may do with comments; `'none'` where the type has none */
  comments?: CommentRights
  /** For a type with history: see versions, also make them, or also restore them */
  versions?: 'read' | 'create' | 'restore'
  /**
   * For a type with suggestions: none, only see them; `own`, suggest and
   * edit and withdraw one's own; `all`, also accept and reject anyone's
   */
  suggestions?: 'none' | 'own' | 'all'
}

/**
 * Presence in a namespace: who has which document open, doing what. Watching a
 * document is not presence: a list of documents is not having them open.
 */
export interface PresenceEntry {
  principal: Principal
  namespace: string
  id: string
  mode: 'reading' | 'editing'
  /** Whether the page showing it is visible */
  visible: boolean
}

/** A record of a document: something that happened, never edited */
export interface DocumentRecord {
  seq: number
  kind: string
  at: number
  actor: Principal
  onBehalfOf?: Principal
  data: unknown
}

export interface Limits {
  /** Documents one connection may have open */
  open: number
  /** Documents one connection may watch */
  watch: number
  /** Largest frame, in bytes */
  frame: number
}

/** The headers of each frame */
export interface Headers {
  [ToServer.HELLO]: { protocol: number, token: string }
  [ToServer.OPEN]: {
    ref: number
    namespace: string
    id: string
    mode: 'open' | 'watch'
    /** For watching: the fields, as dot paths */
    paths?: string[]
    /** The Y.js client id this client will write the document with */
    clientId?: number
    /** The incarnation of a copy the client kept, if any */
    incarnation?: string
    /** The client's state vector of each layer besides the content, base64 */
    layers?: Partial<Record<Layer, string>>
  }
  [ToServer.CLOSE]: { ref: number }
  [ToServer.UPDATE]: { ref: number, layer: Layer, seq: number, claim?: ActorClaim }
  [ToServer.AWARENESS]: { ref: number }
  /** `id`: the same for a record sent again, so it is stored once */
  [ToServer.RECORD]: {
    ref: number, seq: number, kind: string, data: unknown, claim?: ActorClaim, id?: string
  }
  [ToServer.RPC]: { call: number, name: string, args: unknown }
  [ToServer.TOKEN]: { token: string }
  [ToServer.PING]: Record<string, never>
  [ToServer.MODE]: { ref: number, mode: 'reading' | 'editing', visible: boolean }
  [ToServer.PRESENCE]: { namespace: string, follow: boolean }
  [ToServer.SAVE]: { ref: number, call: number, label?: string }
  /** A version by its id, or the content at a log position */
  [ToServer.VERSION]: { ref: number, call: number, id?: string, seq?: number }
  [ToServer.RESTORE]: { ref: number, call: number, id: string }
  [ToServer.REVIEW]: { ref: number, call: number, run?: string }
  [ToServer.UNREVIEWED]: { ref: number, call: number }
  [ToServer.NODE_MESSAGE]: { namespace: string, id: string, message: unknown }

  [ToClient.WELCOME]: { protocol: number, principal: Principal, namespaces: string[] | '*', limits: Limits }
  [ToClient.REFUSED]: { code: ReasonCode, reason: string }
  [ToClient.OPENED]: {
    ref: number
    type: string
    incarnation: string
    capabilities: Capabilities
    /** The document's log position the capabilities hold from */
    seq: number
    /** The server's state vector, base64: the client sends what is beyond it */
    stateVector?: string
    /** For watching: the projection */
    projection?: unknown
    /** The records so far */
    records?: DocumentRecord[]
    /** The layers besides the content the type has: the server's state vector and what the client lacks, base64 */
    layers?: Partial<Record<Layer, { stateVector: string, missing: string }>>
    /** For a type with history: who wrote what in each layer, Y.js ContentMaps, base64 */
    attributions?: Partial<Record<Layer, string>>
    /** The people the attributions name, by their key */
    people?: Record<string, Person>
    /** For a type with history: its versions, oldest first */
    versions?: VersionInfo[]
  }
  [ToClient.CLOSED]: { ref: number, code: ReasonCode, reason: string }
  [ToClient.UPDATE]: { ref: number, layer: Layer, /** The log position it was stored at */ log?: number }
  [ToClient.ACK]: { ref: number, seq: number, log: number }
  [ToClient.REJECTED]: { ref: number, seq: number, code: ReasonCode, reason: string }
  [ToClient.AWARENESS]: { ref: number }
  [ToClient.PROJECTION]: { ref: number, projection: unknown }
  [ToClient.RECORDS]: { ref: number, records: DocumentRecord[], seq?: number }
  [ToClient.POLICY]: { ref: number, seq: number, capabilities: Capabilities }
  [ToClient.PRESENCE]: { namespace: string, entries: PresenceEntry[] }
  [ToClient.MESSAGE]: { ref: number, message: unknown }
  [ToClient.RESULT]: { call: number, ok: boolean, value?: unknown, code?: ReasonCode, reason?: string }
  [ToClient.PONG]: Record<string, never>
  [ToClient.SAVED]: { ref: number, call: number, log: number }
  [ToClient.ATTRIBUTIONS]: { ref: number, layer: Layer, people: Record<string, Person> }
  [ToClient.VERSIONS]: { ref: number, versions: VersionInfo[] }
}

export type FrameType = keyof Headers

export interface Frame<T extends FrameType = FrameType> {
  type: T
  header: Headers[T]
  payload: Uint8Array
}

const EMPTY = new Uint8Array(0)

export function encodeFrame<T extends FrameType>(type: T, header: Headers[T], payload: Uint8Array = EMPTY): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, type)
  encoding.writeVarString(encoder, JSON.stringify(header))
  encoding.writeVarUint8Array(encoder, payload)
  return encoding.toUint8Array(encoder)
}

/** A frame, or nothing when the bytes are not one */
export function decodeFrame(data: Uint8Array): Frame | undefined {
  try {
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder) as FrameType
    const header = JSON.parse(decoding.readVarString(decoder)) as Headers[FrameType]
    const payload = decoding.readVarUint8Array(decoder)
    return { type, header, payload }
  } catch {
    return undefined
  }
}

/** Narrows a frame to its type */
export function isFrame<T extends FrameType>(frame: Frame, type: T): frame is Frame<T> {
  return frame.type === type
}

/** WebSocket close codes: 4400-4499 tell a client not to reconnect */
export const CloseCode = {
  /** The token was refused */
  UNAUTHENTICATED: 4401,
  /** The client's protocol is too old: reload */
  STALE_PROTOCOL: 4426,
  /** The principal changed on this connection */
  PRINCIPAL_CHANGED: 4409
} as const
