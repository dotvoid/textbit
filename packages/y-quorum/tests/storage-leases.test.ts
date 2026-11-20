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
