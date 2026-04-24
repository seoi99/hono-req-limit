import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { MemoryStore } from '../store/memory'
import { RedisStore } from '../store/redis'
import { rateLimit } from '../index'
import type { RedisLike } from '../types'

describe('MemoryStore - block / isBlocked', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('isBlocked returns false when key is not blocked', async () => {
    const store = new MemoryStore()
    expect(await store.isBlocked('key')).toBe(false)
  })

  it('block sets a blockedUntil timestamp', async () => {
    const store = new MemoryStore()
    const before = Date.now()
    await store.block('key', 5_000)
    const result = await store.isBlocked('key')
    expect(result).toBeGreaterThanOrEqual(before + 5_000)
  })

  it('isBlocked returns false after the duration expires', async () => {
    const store = new MemoryStore()
    await store.block('key', 5_000)
    vi.advanceTimersByTime(5_001)
    expect(await store.isBlocked('key')).toBe(false)
  })

  it('block on one key does not affect another', async () => {
    const store = new MemoryStore()
    await store.block('key-a', 5_000)
    expect(await store.isBlocked('key-b')).toBe(false)
  })
})

describe('RedisStore - block / isBlocked', () => {
  function mockClient(): RedisLike {
    return {
      evalScript: vi.fn().mockResolvedValue(0),
      del: vi.fn().mockResolvedValue(1),
      ping: vi.fn().mockResolvedValue('PONG'),
    }
  }

  it('block calls evalScript with the block key and duration', async () => {
    const client = mockClient()
    const store = new RedisStore(client)
    await store.block('rate:ip', 5_000)
    expect(client.evalScript).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'rate:ip:blocked',
      5_000,
    )
  })

  it('isBlocked returns false when pttl is 0 or negative', async () => {
    const client = mockClient()
    vi.mocked(client.evalScript).mockResolvedValue(0)
    const store = new RedisStore(client)
    expect(await store.isBlocked('key')).toBe(false)
  })

  it('isBlocked returns blockedUntil when pttl > 0', async () => {
    const client = mockClient()
    vi.mocked(client.evalScript).mockResolvedValue(5_000)
    const store = new RedisStore(client)
    const before = Date.now()
    const result = await store.isBlocked('key')
    expect(result).toBeGreaterThanOrEqual(before + 5_000)
  })
})

describe('rateLimit - blockDuration middleware', () => {
  afterEach(() => vi.useRealTimers())

  it('returns 429 immediately when the key is already blocked', async () => {
    const store = new MemoryStore()
    vi.useFakeTimers()
    await store.block('unknown', 60_000)
    const app = new Hono()
    app.use('*', rateLimit({ store, limit: 10, blockDuration: 60_000 }))
    app.get('/', (c) => c.text('OK'))
    const res = await app.request('/')
    expect(res.status).toBe(429)
  })

  it('sets a block after limit is exceeded', async () => {
    const store = new MemoryStore()
    const app = new Hono()
    app.use('*', rateLimit({ store, limit: 1, blockDuration: 60_000 }))
    app.get('/', (c) => c.text('OK'))
    await app.request('/')
    await app.request('/') // exceeds limit → block set
    expect(await store.isBlocked('unknown')).not.toBe(false)
  })

  it('includes Retry-After reflecting block end when blocked', async () => {
    vi.useFakeTimers()
    const store = new MemoryStore()
    await store.block('unknown', 300_000)
    const app = new Hono()
    app.use('*', rateLimit({ store, limit: 10, blockDuration: 300_000 }))
    app.get('/', (c) => c.text('OK'))
    const res = await app.request('/')
    const retryAfter = Number(res.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(300)
  })

  it('does not block when blockDuration is not set', async () => {
    const store = new MemoryStore()
    const app = new Hono()
    app.use('*', rateLimit({ store, limit: 1 }))
    app.get('/', (c) => c.text('OK'))
    await app.request('/')
    await app.request('/') // exceeds limit
    expect(await store.isBlocked('unknown')).toBe(false)
  })
})
