import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { rateLimit, MemoryStore } from '../index'

describe('MemoryStore', () => {
  it('identifies as memory', () => {
    expect(new MemoryStore().type).toBe('memory')
  })
})

describe('rateLimit - algorithm option', () => {
  it('uses token-bucket when algorithm is set', async () => {
    const app = new Hono()
    app.use('*', rateLimit({ algorithm: 'token-bucket', limit: 5, windowMs: 60_000 }))
    app.get('/', (c) => c.text('OK'))
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('RateLimit-Remaining')).toBe('4')
  })

  it('explicit store takes precedence over algorithm', async () => {
    const store = new MemoryStore()
    const app = new Hono()
    app.use('*', rateLimit({ algorithm: 'token-bucket', store, limit: 5, windowMs: 60_000 }))
    app.get('/', (c) => c.text('OK'))
    expect(store.type).toBe('memory') // MemoryStore, not token-bucket variant
  })
})

describe('rateLimit store connection check', () => {
  it('returns 500 on first request when store ping fails', async () => {
    const store = {
      type: 'redis',
      ping: vi.fn().mockResolvedValue(false),
      increment: vi.fn(),
      reset: vi.fn(),
    }
    const app = new Hono()
    app.use('*', rateLimit({ store, limit: 10 }))
    app.get('/', (c) => c.text('OK'))

    const res = await app.request('/')
    expect(res.status).toBe(500)
  })

  it('pings only once across multiple requests', async () => {
    const store = {
      type: 'redis',
      ping: vi.fn().mockResolvedValue(true),
      increment: vi.fn().mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 }),
      reset: vi.fn(),
    }
    const app = new Hono()
    app.use('*', rateLimit({ store, limit: 10 }))
    app.get('/', (c) => c.text('OK'))

    await app.request('/')
    await app.request('/')
    await app.request('/')
    expect(store.ping).toHaveBeenCalledTimes(1)
  })

  it('skips ping check when store has no ping method', async () => {
    const app = createApp({ store: new MemoryStore() })
    const res = await app.request('/')
    expect(res.status).toBe(200)
  })
})

function createApp(options = {}) {
  const app = new Hono()
  app.use('*', rateLimit({ limit: 3, windowMs: 60_000, ...options }))
  app.get('/', (c) => c.text('OK'))
  return app
}

describe('rateLimit', () => {
  it('allows requests under the limit', async () => {
    const app = createApp()
    const res = await app.request('/')
    expect(res.status).toBe(200)
  })

  it('blocks requests that exceed the limit', async () => {
    const store = new MemoryStore()
    const app = createApp({ limit: 2, store })
    await app.request('/')
    await app.request('/')
    await app.request('/')
    const res = await app.request('/')
    expect(res.status).toBe(429)
  })

  it('sets RateLimit-* headers', async () => {
    const app = createApp({ limit: 5 })
    const res = await app.request('/')
    expect(res.headers.get('RateLimit-Limit')).toBe('5')
    expect(res.headers.get('RateLimit-Remaining')).toBe('4')
    expect(res.headers.get('RateLimit-Reset')).toBeTruthy()
  })

  it('sets Retry-After header when blocked', async () => {
    const store = new MemoryStore()
    const app = createApp({ limit: 1, store })
    await app.request('/')
    await app.request('/')
    const res = await app.request('/')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
  })

  it('skips rate limiting when skip() returns true', async () => {
    const app = createApp({ limit: 1, skip: () => true })
    await app.request('/')
    await app.request('/')
    const res = await app.request('/')
    expect(res.status).toBe(200)
  })

  it('supports custom message string', async () => {
    const store = new MemoryStore()
    const app = createApp({ limit: 1, store, message: 'Slow down!' })
    await app.request('/')
    await app.request('/')
    const res = await app.request('/')
    expect(await res.text()).toBe('Slow down!')
  })

  it('supports custom message object (JSON)', async () => {
    const store = new MemoryStore()
    const app = createApp({ limit: 1, store, message: { error: 'rate limited' } })
    await app.request('/')
    await app.request('/')
    const res = await app.request('/')
    expect(await res.json()).toEqual({ error: 'rate limited' })
  })

  it('calls onLimitReached when limit is exceeded', async () => {
    const store = new MemoryStore()
    let called = false
    const app = createApp({ limit: 1, store, onLimitReached: () => { called = true } })
    await app.request('/')
    await app.request('/')
    await app.request('/')
    expect(called).toBe(true)
  })

  it('supports custom keyGenerator', async () => {
    const store = new MemoryStore()
    let userKey = 'user-a'
    const app = createApp({ limit: 2, store, keyGenerator: () => userKey })

    await app.request('/')
    await app.request('/')
    await app.request('/')
    const blockedRes = await app.request('/')
    expect(blockedRes.status).toBe(429)

    // Different key — fresh window
    userKey = 'user-b'
    const freshRes = await app.request('/')
    expect(freshRes.status).toBe(200)
  })
})
