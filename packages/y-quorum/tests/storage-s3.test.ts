// The object storage wrapper over memory storage, with a bucket in a Map: the
// round trips come back whole, and the blobs live in the bucket
import { beforeEach, describe, expect, it } from 'vitest'
import type { Principal, VersionInfo } from '@dotvoid/y-quorum-client/protocol'
import {
  memory, s3, type Actor, type Checkpoint, type LogEntry, type S3Bucket, type Storage
} from '../lib'

const alice: Principal = { kind: 'person', id: 'alice', name: 'Alice' }
const actor: Actor = { principal: alice }
const meta = { type: 'example/article', incarnation: 'i-1', createdAt: 1 }
const bytes = (...values: number[]) => new Uint8Array(values)
const entry = (seq: number): LogEntry =>
  ({ seq, at: seq, layer: 'content', actor, update: bytes(seq) })
const version = (id: string, seq: number): VersionInfo =>
  ({ id, seq, at: seq, by: { kind: 'person', id: 'alice', name: 'Alice' }, kind: 'saved' })

let objects: Map<string, Uint8Array>
let inner: Storage
let storage: Storage

beforeEach(() => {
  objects = new Map()
  const bucket: S3Bucket = {
    put: async (key, body) => {
      objects.set(key, new Uint8Array(body))
    },
    get: async (key) => objects.get(key),
    delete: async (prefix) => {
      for (const key of [...objects.keys()]) {
        if (key.startsWith(prefix)) {
          objects.delete(key)
        }
      }
    }
  }
  inner = memory()
  storage = s3(inner, bucket, { prefix: 'docs', inline: 4 })
})

const large = bytes(1, 2, 3, 4, 5, 6)

describe('s3 storage', () => {
  it('keeps checkpoint states and large attribution maps in the bucket', async () => {
    const checkpoint: Checkpoint = {
      states: { content: bytes(1, 1), comments: bytes(2, 2) },
      attributions: { content: large, comments: bytes(7) },
      people: { alice: { kind: 'person', id: 'alice', name: 'Alice' } },
      reviewed: bytes(4)
    }
    await storage.create('news', 'a/b', meta, checkpoint)
    expect([...objects.keys()].sort()).toEqual([
      'docs/news/a%2Fb/checkpoint/0/attributions/content',
      'docs/news/a%2Fb/checkpoint/0/comments',
      'docs/news/a%2Fb/checkpoint/0/content'
    ])
    expect(objects.get('docs/news/a%2Fb/checkpoint/0/content')).toEqual(bytes(1, 1))
    // The inner storage keeps references, and the small map itself
    const kept = await inner.load('news', 'a/b')
    expect(kept?.checkpoint?.states.content).not.toEqual(bytes(1, 1))
    expect(kept?.checkpoint?.attributions?.comments).toEqual(bytes(0, 7))
    expect((await storage.load('news', 'a/b'))?.checkpoint).toEqual({ ...checkpoint, seq: 0 })
  })

  it('loads the latest checkpoint and the log after it, and lets the old objects go', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    await storage.append('news', 'a', [entry(1), entry(2), entry(3)])
    await storage.checkpoint('news', 'a', { states: { content: bytes(9) } }, 2)
    const loaded = await storage.load('news', 'a')
    expect(loaded?.checkpoint).toEqual({ seq: 2, states: { content: bytes(9) } })
    expect(loaded?.entries).toEqual([entry(3)])
    expect(await storage.log('news', 'a')).toHaveLength(3)
    expect([...objects.keys()]).toEqual(['docs/news/a/checkpoint/2/content'])
  })

  it('keeps version states in the bucket', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    await storage.addVersion('news', 'a', version('v1', 0), bytes(5, 5))
    expect(objects.get('docs/news/a/versions/v1')).toEqual(bytes(5, 5))
    expect(await storage.versionState('news', 'a', 'v1')).toEqual(bytes(5, 5))
    expect(await storage.versionState('news', 'a', 'v2')).toBeUndefined()
    expect((await storage.load('news', 'a'))?.versions).toEqual([version('v1', 0)])
  })

  it('reloads when another node let the objects it read of go', async () => {
    await storage.create('news', 'a', meta, { states: { content: bytes(1) } })
    // As another node would: a new checkpoint, and the old objects deleted
    const reference = (await inner.load('news', 'a'))!.checkpoint!.states.content!
    await storage.checkpoint('news', 'a', { states: { content: bytes(2) } }, 1)
    const read = inner.load.bind(inner)
    let first = true
    inner.load = async (namespace, id) => {
      const stored = await read(namespace, id)
      if (first && stored?.checkpoint) {
        first = false
        return { ...stored, checkpoint: { seq: 0, states: { content: reference } } }
      }
      return stored
    }
    expect((await storage.load('news', 'a'))?.checkpoint?.states.content).toEqual(bytes(2))
  })

  it('deletes a document’s objects with it, or a namespace’s', async () => {
    for (const [namespace, id] of [['news', 'a'], ['news', 'ab'], ['sport', 'a']]) {
      await storage.create(namespace, id, meta, { states: { content: bytes(1) } })
      await storage.addVersion(namespace, id, version('v1', 0), bytes(1))
    }
    await storage.delete('news', 'a')
    expect(await storage.load('news', 'a')).toBeUndefined()
    expect([...objects.keys()].filter((key) => key.startsWith('docs/news/'))).toEqual([
      'docs/news/ab/checkpoint/0/content',
      'docs/news/ab/versions/v1'
    ])
    await storage.delete('news')
    expect(await storage.load('news', 'ab')).toBeUndefined()
    expect([...objects.keys()].sort()).toEqual([
      'docs/sport/a/checkpoint/0/content',
      'docs/sport/a/versions/v1'
    ])
    expect((await storage.load('sport', 'a'))?.checkpoint?.states.content).toEqual(bytes(1))
  })

  it('passes on what the inner storage has, and only that', async () => {
    const withoutLease: Storage = { ...memory() }
    delete withoutLease.lease
    const bucket: S3Bucket = {
      put: async () => {},
      get: async () => undefined,
      delete: async () => {}
    }
    expect(s3(withoutLease, bucket).lease).toBeUndefined()
    const lease = async () => ({ holder: 'n', address: '', epoch: 1, until: 0 })
    const withLease = s3({ ...memory(), lease }, bucket)
    expect(await withLease.lease?.('news', 'a', { id: 'n', address: '' }, 1))
      .toMatchObject({ epoch: 1 })
  })
})
