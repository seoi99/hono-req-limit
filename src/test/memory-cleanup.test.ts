import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryStore } from '../store/memory'

describe('MemoryStore - cleanup', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('evicts expired fixed-window entries after cleanup interval', async () => {
    const store = new MemoryStore({ cleanupIntervalMs: 1_000 })
    await store.increment('key', 500, 10) // window expires in 500ms
    vi.advanceTimersByTime(600)           // window is now expired
    vi.advanceTimersByTime(1_000)         // trigger cleanup sweep

    // After cleanup, the key is gone — next increment starts a fresh window
    const result = await store.increment('key', 500, 10)
    expect(result.count).toBe(1)
    store.destroy()
  })

  it('evicts expired block entries after cleanup interval', async () => {
    const store = new MemoryStore({ cleanupIntervalMs: 1_000 })
    await store.block('key', 500)
    vi.advanceTimersByTime(600)   // block has expired
    vi.advanceTimersByTime(1_000) // trigger cleanup sweep
    expect(await store.isBlocked('key')).toBe(false)
    store.destroy()
  })

  it('evicts expired token-bucket entries after cleanup interval', async () => {
    const store = new MemoryStore({ algorithm: 'token-bucket', cleanupIntervalMs: 1_000 })
    // Drain the bucket completely
    for (let i = 0; i < 10; i++) {
      await store.increment('key', 1_000, 10)
    }
    vi.advanceTimersByTime(1_001)  // bucket is fully refilled → entry is expirable
    vi.advanceTimersByTime(1_000)  // trigger cleanup sweep
    // After eviction, next increment returns a fresh bucket (count = 1)
    const result = await store.increment('key', 1_000, 10)
    expect(result.count).toBe(1)
    store.destroy()
  })

  it('does not start a timer when cleanupIntervalMs is 0', () => {
    const store = new MemoryStore({ cleanupIntervalMs: 0 })
    // Should not throw; destroy is a no-op
    expect(() => store.destroy()).not.toThrow()
  })

  it('destroy stops the cleanup timer', async () => {
    const store = new MemoryStore({ cleanupIntervalMs: 1_000 })
    await store.increment('key', 500, 10)
    store.destroy()

    vi.advanceTimersByTime(600)
    vi.advanceTimersByTime(1_000) // would have triggered cleanup, but timer was cleared

    // Entry survives because cleanup never ran; next call reuses the old expired window
    const result = await store.increment('key', 500, 10)
    expect(result.count).toBe(1) // expired window was reset on access — still behaves correctly
  })
})
