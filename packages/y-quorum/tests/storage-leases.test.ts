// Leases in the storages without a server of their own: deleting a document
// ends its lease, so the node holding it writes nothing more
import { describe, expect, it } from 'vitest'
import type { Principal } from '@dotvoid/y-quorum-client/protocol'
import { memory, sqlite, StaleLease } from '../lib'

const alice: Principal = { kind: 'person', id: 'alice', name: 'Alice' }

describe('deleting a held document', () => {
  const meta = { type: 'example/plan', incarnation: 'i', createdAt: 0 }
  const entry = {
    seq: 1, at: 0, layer: 'content' as const, actor: { principal: alice }, update: new Uint8Array()
  }
  const node = { id: 'n1', address: 'ws://n1' }

  it.each([['memory', () => memory()], ['SQLite', () => sqlite(':memory:')]] as const)(
    'ends the lease with the next epoch in %s, so its holder writes nothing more',
    async (_name, make) => {
      const store = make()
      await store.create('news', 'd-1', meta, { states: {} })
      const held = await store.lease!('news', 'd-1', node, 60_000)
      expect(await store.leaseOf!('news', 'd-1')).toMatchObject({ holder: 'n1', epoch: held.epoch })
      await store.delete('news', 'd-1')
      expect((await store.lease!('news', 'd-1', node, 60_000)).epoch).toBeGreaterThan(held.epoch)
      await expect(store.append('news', 'd-1', [entry], held.epoch))
        .rejects.toBeInstanceOf(StaleLease)
      await store.close?.()
    }
  )
})

describe('a lease run out', () => {
  const meta = { type: 'example/plan', incarnation: 'i', createdAt: 0 }
  const node = { id: 'n1', address: 'ws://n1' }

  it.each([['memory', () => memory()], ['SQLite', () => sqlite(':memory:')]] as const)(
    'is taken again with the next epoch in %s, even by the node that had it',
    async (_name, make) => {
      const store = make()
      await store.create('news', 'd-1', meta, { states: {} })
      const held = await store.lease!('news', 'd-1', node, 20)
      await new Promise((resolve) => setTimeout(resolve, 40))
      expect((await store.lease!('news', 'd-1', node, 60_000)).epoch).toBe(held.epoch + 1)
      await store.close?.()
    }
  )
})

describe('a deleted document', () => {
  const meta = { type: 'example/plan', incarnation: 'i', createdAt: 0 }

  it('keeps nothing written beside it in SQLite, by a node that has not noticed', async () => {
    const store = sqlite(':memory:')
    await store.create('news', 'd-1', meta, { states: {} })
    await store.delete('news', 'd-1')
    await store.appendHistory('news', 'd-1', [
      { seq: 1, from: 1, to: 1, at: 0, kind: 'edit', actor: { by: 'person:alice' }, hash: 'h' }
    ] as never)
    await store.appendRecord('news', 'd-1', { seq: 1, kind: 'k', at: 0, actor: alice, data: {} })
    expect(await store.claimClient('news', 'd-1', 7, 'alice')).toBe(false)
    await store.create('news', 'd-1', meta, { states: {} })
    const made = await store.load('news', 'd-1')
    expect(made).toMatchObject({ records: [] })
    expect(made?.historyHead).toBeUndefined()
    await store.close?.()
  })
})
