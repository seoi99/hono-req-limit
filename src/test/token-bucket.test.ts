import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryStore } from '../store/memory'
import { RedisStore } from '../store/redis'
import type { RedisLike } from '../types'

describe('MemoryStore - token-bucket', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('allows first request and returns count 1', async () => {
    const store = new MemoryStore({ algorithm: 'token-bucket' })
    const result = await store.increment('key', 60_000, 10)
    expect(result.count).toBe(1)
  })

  it('allows up to the limit consecutively', async () => {
    const store = new MemoryStore({ algorithm: 'token-bucket' })
    let last = { count: 0, resetAt: 0 }
    for (let i = 0; i < 10; i++) {
      last = await store.increment('key', 60_000, 10)
    }
    expect(last.count).toBeLessThanOrEqual(10)
  })

  it('denies when bucket is exhausted', async () => {
    const store = new MemoryStore({ algorithm: 'token-bucket' })
    for (let i = 0; i < 10; i++) {
      await store.increment('key', 60_000, 10)
    }
    const denied = await store.increment('key', 60_000, 10)
    expect(denied.count).toBe(11)
  })

  it('refills tokens after time passes', async () => {
    const store = new MemoryStore({ algorithm: 'token-bucket' })
    for (let i = 0; i < 10; i++) {
      await store.increment('key', 60_000, 10)
    }
    vi.advanceTimersByTime(60_000)
    const result = await store.increment('key', 60_000, 10)
    expect(result.count).toBeLessThanOrEqual(10)
  })

  it('provides a resetAt in the future', async () => {
    const store = new MemoryStore({ algorithm: 'token-bucket' })
    const before = Date.now()
    const result = await store.increment('key', 60_000, 10)
    expect(result.resetAt).toBeGreaterThanOrEqual(before)
  })

  it('reset clears bucket state', async () => {
    const store = new MemoryStore({ algorithm: 'token-bucket' })
    for (let i = 0; i < 10; i++) {
      await store.increment('key', 60_000, 10)
    }
    await store.reset('key')
    const result = await store.increment('key', 60_000, 10)
    expect(result.count).toBe(1)
  })
})

describe('RedisStore - token-bucket', () => {
  function mockClient(evalResult: unknown = [1, 1, Date.now() + 60_000]): RedisLike {
    return {
      eval: vi.fn().mockResolvedValue(evalResult),
      del: vi.fn().mockResolvedValue(1),
      ping: vi.fn().mockResolvedValue('PONG'),
    }
  }

  it('returns count from lua result when allowed', async () => {
    const client = mockClient([1, 3, Date.now() + 60_000])
    const store = new RedisStore(client, { algorithm: 'token-bucket' })
    const result = await store.increment('key', 60_000, 10)
    expect(result.count).toBe(3)
  })

  it('returns limit+1 as count when denied', async () => {
    const client = mockClient([0, 11, Date.now() + 6_000])
    const store = new RedisStore(client, { algorithm: 'token-bucket' })
    const result = await store.increment('key', 60_000, 10)
    expect(result.count).toBe(11)
  })

  it('passes capacity and refillRate to eval', async () => {
    const client = mockClient([1, 1, Date.now() + 60_000])
    const store = new RedisStore(client, { algorithm: 'token-bucket' })
    await store.increment('key', 60_000, 10)
    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'key',
      10,           // capacity = limit
      10 / 60_000,  // refillRate
      expect.any(Number),
    )
  })
})
