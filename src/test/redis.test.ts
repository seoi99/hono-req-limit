import { describe, it, expect, vi } from 'vitest'
import { RedisStore } from '../store/redis'
import type { RedisLike } from '../types'

function createMockClient(evalResult: unknown = [1, 60000]): RedisLike {
  return {
    eval: vi.fn().mockResolvedValue(evalResult),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
  }
}

describe('RedisStore', () => {
  describe('type', () => {
    it('identifies as redis', () => {
      const store = new RedisStore(createMockClient())
      expect(store.type).toBe('redis')
    })
  })

  describe('increment - fixed-window', () => {
    it('returns count and resetAt from lua result', async () => {
      const client = createMockClient([3, 45000])
      const store = new RedisStore(client)
      const before = Date.now()
      const info = await store.increment('test-key', 60000, 10)
      const after = Date.now()

      expect(info.count).toBe(3)
      expect(info.resetAt).toBeGreaterThanOrEqual(before + 45000)
      expect(info.resetAt).toBeLessThanOrEqual(after + 45000)
    })

    it('calls eval with the key and windowMs as args', async () => {
      const client = createMockClient([1, 60000])
      const store = new RedisStore(client)
      await store.increment('rate:127.0.0.1', 30000, 10)

      expect(client.eval).toHaveBeenCalledWith(
        expect.stringContaining('INCR'),
        1,
        'rate:127.0.0.1',
        30000,
      )
    })

    it('clamps negative pttl to 0 in resetAt', async () => {
      const client = createMockClient([1, -1])
      const store = new RedisStore(client)
      const before = Date.now()
      const info = await store.increment('key', 60000, 10)

      expect(info.resetAt).toBeGreaterThanOrEqual(before)
    })
  })

  describe('reset', () => {
    it('calls del with the key', async () => {
      const client = createMockClient()
      const store = new RedisStore(client)
      await store.reset('rate:127.0.0.1')

      expect(client.del).toHaveBeenCalledWith('rate:127.0.0.1')
    })
  })

  describe('ping', () => {
    it('returns true when redis responds', async () => {
      const client = createMockClient()
      const store = new RedisStore(client)

      expect(await store.ping()).toBe(true)
    })

    it('returns false when redis throws', async () => {
      const client = createMockClient()
      vi.mocked(client.ping).mockRejectedValue(new Error('ECONNREFUSED'))
      const store = new RedisStore(client)

      expect(await store.ping()).toBe(false)
    })
  })
})
