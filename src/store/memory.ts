import type { Algorithm, RateLimitInfo, RateLimitStore } from '../types'

export interface MemoryStoreOptions {
  algorithm?: Algorithm
}

interface FixedWindowEntry {
  count: number
  resetAt: number
}

interface TokenBucketEntry {
  tokens: number
  lastRefill: number
}

export class MemoryStore implements RateLimitStore {
  readonly type = 'memory' as const
  private readonly algorithm: Algorithm
  private fixedStore = new Map<string, FixedWindowEntry>()
  private tokenStore = new Map<string, TokenBucketEntry>()
  private blocks = new Map<string, number>()

  constructor({ algorithm = 'fixed-window' }: MemoryStoreOptions = {}) {
    this.algorithm = algorithm
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
      this.tokenStore.set(key, { tokens, lastRefill: now })
      const count = limit - Math.floor(tokens)
      const msUntilFull = Math.ceil((limit - tokens) / refillRate)
      return { count, resetAt: now + msUntilFull }
    }

    // Denied — not enough tokens
    this.tokenStore.set(key, { tokens: refilled, lastRefill: now })
    const msUntilNextToken = Math.ceil((1 - refilled) / refillRate)
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
