import type { Algorithm, RateLimitInfo, RateLimitStore } from '../types'

export interface MemoryStoreOptions {
  algorithm?: Algorithm
  /** How often (ms) to sweep and evict expired entries. Default: 300_000 (5 min). Pass 0 to disable. */
  cleanupIntervalMs?: number
}

interface FixedWindowEntry {
  count: number
  resetAt: number
}

interface TokenBucketEntry {
  tokens: number
  lastRefill: number
  /** Earliest time this entry can be safely evicted (bucket fully refilled). */
  expiresAt: number
}

export class MemoryStore implements RateLimitStore {
  readonly type = 'memory' as const
  private readonly algorithm: Algorithm
  private fixedStore = new Map<string, FixedWindowEntry>()
  private tokenStore = new Map<string, TokenBucketEntry>()
  private blocks = new Map<string, number>()
  private cleanupTimer: ReturnType<typeof setInterval> | undefined

  constructor({ algorithm = 'fixed-window', cleanupIntervalMs = 300_000 }: MemoryStoreOptions = {}) {
    this.algorithm = algorithm
    if (cleanupIntervalMs > 0) {
      const timer = setInterval(() => this.cleanup(), cleanupIntervalMs)
      // Prevent the timer from keeping the Node.js process alive after the server shuts down
      ;(timer as unknown as { unref?(): void }).unref?.()
      this.cleanupTimer = timer
    }
  }

  /** Clear the cleanup timer. Call this when the store is no longer needed. */
  destroy(): void {
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.fixedStore) {
      if (entry.resetAt <= now) this.fixedStore.delete(key)
    }
    for (const [key, entry] of this.tokenStore) {
      if (entry.expiresAt <= now) this.tokenStore.delete(key)
    }
    for (const [key, ts] of this.blocks) {
      if (ts <= now) this.blocks.delete(key)
    }
  }

  async increment(key: string, windowMs: number, limit: number): Promise<RateLimitInfo> {
    return this.algorithm === 'token-bucket'
      ? this.tokenBucketIncrement(key, windowMs, limit)
      : this.fixedWindowIncrement(key, windowMs)
  }

  private fixedWindowIncrement(key: string, windowMs: number): RateLimitInfo {
    const now = Date.now()
    const entry = this.fixedStore.get(key)

    if (!entry || entry.resetAt <= now) {
      const fresh: FixedWindowEntry = { count: 1, resetAt: now + windowMs }
      this.fixedStore.set(key, fresh)
      return fresh
    }

    entry.count++
    return entry
  }

  private tokenBucketIncrement(key: string, windowMs: number, limit: number): RateLimitInfo {
    const now = Date.now()
    const refillRate = limit / windowMs // tokens per ms

    const entry = this.tokenStore.get(key)
    const prevTokens = entry?.tokens ?? limit
    const prevRefill = entry?.lastRefill ?? now

    const refilled = Math.min(limit, prevTokens + (now - prevRefill) * refillRate)

    if (refilled >= 1) {
      const tokens = refilled - 1
      const msUntilFull = Math.ceil((limit - tokens) / refillRate)
      this.tokenStore.set(key, { tokens, lastRefill: now, expiresAt: now + msUntilFull })
      const count = limit - Math.floor(tokens)
      return { count, resetAt: now + msUntilFull }
    }

    // Denied — not enough tokens
    const msUntilNextToken = Math.ceil((1 - refilled) / refillRate)
    const msUntilFull = Math.ceil((limit - refilled) / refillRate)
    this.tokenStore.set(key, { tokens: refilled, lastRefill: now, expiresAt: now + msUntilFull })
    return { count: limit + 1, resetAt: now + msUntilNextToken }
  }

  async reset(key: string): Promise<void> {
    this.fixedStore.delete(key)
    this.tokenStore.delete(key)
  }

  async block(key: string, durationMs: number): Promise<void> {
    this.blocks.set(key, Date.now() + durationMs)
  }

  async isBlocked(key: string): Promise<number | false> {
    const blockedUntil = this.blocks.get(key)
    if (blockedUntil === undefined) return false
    if (blockedUntil <= Date.now()) {
      this.blocks.delete(key)
      return false
    }
    return blockedUntil
  }
}
