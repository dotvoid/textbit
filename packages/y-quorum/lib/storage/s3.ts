import type { Layer } from '@dotvoid/y-quorum-client/protocol'
import type { Checkpoint, Storage } from '../types'

/**
 * What the adapter needs of object storage. Small, so a host plugs in whatever
 * it has. With `@aws-sdk/client-s3`, for S3, MinIO, R2 and the like:
 *
 * ```ts
 * import {
 *   S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command,
 *   DeleteObjectsCommand, NoSuchKey
 * } from '@aws-sdk/client-s3'
 *
 * const client = new S3Client({}) // for MinIO: { endpoint, forcePathStyle: true }
 * const Bucket = 'documents'
 * const bucket: S3Bucket = {
 *   put: async (Key, Body) => {
 *     await client.send(new PutObjectCommand({ Bucket, Key, Body }))
 *   },
 *   get: async (Key) => {
 *     try {
 *       const object = await client.send(new GetObjectCommand({ Bucket, Key }))
 *       return await object.Body?.transformToByteArray()
 *     } catch (error) {
 *       if (error instanceof NoSuchKey) {
 *         return undefined
 *       }
 *       throw error
 *     }
 *   },
 *   delete: async (Prefix) => {
 *     let ContinuationToken: string | undefined
 *     do {
 *       const list = await client.send(
 *         new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken })
 *       )
 *       const Objects = (list.Contents ?? []).map(({ Key }) => ({ Key }))
 *       if (Objects.length) {
 *         await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects } }))
 *       }
 *       ContinuationToken = list.NextContinuationToken
 *     } while (ContinuationToken)
 *   }
 * }
 * const storage = s3(postgres(pool), bucket)
 * ```
 */
export interface S3Bucket {
  put(key: string, body: Uint8Array): Promise<void>
  /** The object, or nothing when there is none */
  get(key: string): Promise<Uint8Array | undefined>
  /** Deletes every object whose key starts with `prefix` */
  delete(prefix: string): Promise<void>
}

export interface S3Options {
  /** What every key starts with. Default: `y-quorum`. */
  prefix?: string
  /** Attribution maps from this many bytes are kept in the bucket. Default: 16 KiB. */
  inline?: number
}

// What the inner storage keeps in a blob's place starts with one of these, so
// a reference is never taken for bytes or bytes for a reference
const INLINE = 0
const REFERENCE = 1

/**
 * Keeps the large blobs of another storage in object storage: checkpoint states,
 * large attribution maps and version states. The inner storage keeps a
 * reference in their place, and everything else: the log, records, history,
 * claims and leases. Keys are `<prefix>/<namespace>/<id>/...`, so deleting a
 * document or a namespace deletes its objects by prefix.
 */
export function s3(inner: Storage, bucket: S3Bucket, options: S3Options = {}): Storage {
  const prefix = options.prefix ?? 'y-quorum'
  const inline = options.inline ?? 16 * 1024
  // Encoded, so a `/` in an id cannot reach into another document's keys
  const folder = (namespace: string, id?: string) => {
    const document = id === undefined ? '' : `${encodeURIComponent(id)}/`
    return `${prefix}/${encodeURIComponent(namespace)}/${document}`
  }
  // The checkpoint each document is at, as far as this process knows: its
  // objects are deleted once a later checkpoint is stored
  const checkpointAt = new Map<string, number>()
  const docKey = (namespace: string, id: string) => `${namespace}\u0000${id}`

  async function put(key: string, body: Uint8Array) {
    await bucket.put(key, body)
    return tagged(REFERENCE, new TextEncoder().encode(key))
  }

  async function resolve(kept: Uint8Array) {
    const body = kept.subarray(1)
    // An adapter may keep a missing content state as no bytes at all
    if (!kept.length) {
      return kept
    }
    if (kept[0] === INLINE) {
      return new Uint8Array(body)
    }
    const key = new TextDecoder().decode(body)
    const object = await bucket.get(key)
    if (!object) {
      throw new MissingObject(key)
    }
    return object
  }

  /** Moves a checkpoint's blobs to the bucket, under its log position */
  async function store(namespace: string, id: string, checkpoint: Checkpoint, seq: number) {
    const base = `${folder(namespace, id)}checkpoint/${seq}/`
    const states: Checkpoint['states'] = {}
    const attributions: NonNullable<Checkpoint['attributions']> = {}
    await Promise.all([
      ...entries(checkpoint.states).map(async ([layer, state]) => {
        states[layer] = await put(`${base}${layer}`, state)
      }),
      ...entries(checkpoint.attributions ?? {}).map(async ([layer, map]) => {
        attributions[layer] = map.length >= inline
          ? await put(`${base}attributions/${layer}`, map)
          : tagged(INLINE, map)
      })
    ])
    return {
      ...checkpoint,
      states,
      ...(checkpoint.attributions ? { attributions } : {})
    }
  }

  async function fetch(checkpoint: Checkpoint) {
    const states: Checkpoint['states'] = {}
    const attributions: NonNullable<Checkpoint['attributions']> = {}
    await Promise.all([
      ...entries(checkpoint.states).map(async ([layer, kept]) => {
        states[layer] = await resolve(kept)
      }),
      ...entries(checkpoint.attributions ?? {}).map(async ([layer, kept]) => {
        attributions[layer] = await resolve(kept)
      })
    ])
    return {
      ...checkpoint,
      states,
      ...(checkpoint.attributions ? { attributions } : {})
    }
  }

  async function load(namespace: string, id: string, again = true): ReturnType<Storage['load']> {
    const stored = await inner.load(namespace, id)
    if (!stored?.checkpoint) {
      return stored
    }
    try {
      const checkpoint = { ...await fetch(stored.checkpoint), seq: stored.checkpoint.seq }
      checkpointAt.set(docKey(namespace, id), stored.checkpoint.seq)
      return { ...stored, checkpoint }
    } catch (error) {
      // Another node checkpointed between reading the reference and the
      // object, and deleted the old objects: what is stored now is newer
      if (again && error instanceof MissingObject) {
        return load(namespace, id, false)
      }
      throw error
    }
  }

  const passed = <K extends keyof Storage>(name: K) => {
    const method = inner[name]
    return method ? { [name]: method.bind(inner) } as Pick<Storage, K> : {}
  }

  return {
    // What the inner store keeps that has no blobs passes straight through
    ...passed('clientHolder'),
    ...passed('lease'),
    ...passed('leaseOf'),
    ...passed('releaseLease'),
    ...passed('addPeople'),
    ...passed('people'),
    ...passed('prune'),
    ...passed('settled'),
    ...passed('unloaded'),
    ...passed('close'),
    load: (namespace, id) => load(namespace, id),
    create: async (namespace, id, meta, checkpoint) => {
      await inner.create(namespace, id, meta, await store(namespace, id, checkpoint, 0))
      checkpointAt.set(docKey(namespace, id), 0)
    },
    append: (namespace, id, entries, epoch) => inner.append(namespace, id, entries, epoch),
    checkpoint: async (namespace, id, checkpoint, seq) => {
      await inner.checkpoint(namespace, id, await store(namespace, id, checkpoint, seq), seq)
      // Only once the inner storage points at the new objects are the old ones
      // let go
      const key = docKey(namespace, id)
      const before = checkpointAt.get(key)
      checkpointAt.set(key, seq)
      if (before !== undefined && before !== seq) {
        await bucket.delete(`${folder(namespace, id)}checkpoint/${before}/`)
      }
    },
    appendRecord: (namespace, id, record) => inner.appendRecord(namespace, id, record),
    log: (namespace, id, from) => inner.log(namespace, id, from),
    addVersion: async (namespace, id, version, state) => {
      const key = `${folder(namespace, id)}versions/${encodeURIComponent(version.id)}`
      await inner.addVersion(namespace, id, version, await put(key, state))
    },
    appendHistory: (namespace, id, entries) => inner.appendHistory(namespace, id, entries),
    history: (namespace, id, from) => inner.history(namespace, id, from),
    versionState: async (namespace, id, versionId) => {
      const kept = await inner.versionState(namespace, id, versionId)
      return kept && resolve(kept)
    },
    claimClient: (namespace, id, client, principal) =>
      inner.claimClient(namespace, id, client, principal),
    delete: async (namespace, id) => {
      // The references first: a failure between leaves objects nothing points
      // at, never a reference to nothing
      await inner.delete(namespace, id)
      for (const key of [...checkpointAt.keys()]) {
        const gone = id !== undefined
          ? key === docKey(namespace, id)
          : key.startsWith(`${namespace}\u0000`)
        if (gone) {
          checkpointAt.delete(key)
        }
      }
      await bucket.delete(folder(namespace, id))
    }
  }
}

class MissingObject extends Error {
  constructor(key: string) {
    super(`y-quorum: no object ${key} in the bucket`)
    this.name = 'MissingObject'
  }
}

function tagged(tag: number, body: Uint8Array) {
  const kept = new Uint8Array(body.length + 1)
  kept[0] = tag
  kept.set(body, 1)
  return kept
}

function entries(parts: Partial<Record<Layer, Uint8Array>>) {
  return (Object.entries(parts) as Array<[Layer, Uint8Array | undefined]>)
    .filter((part): part is [Layer, Uint8Array] => part[1] !== undefined)
}
