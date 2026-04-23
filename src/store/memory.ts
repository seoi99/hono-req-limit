import type { RateLimitInfo, RateLimitStore } from '../types'

interface Entry {
  count: number
  resetAt: number
}

export class MemoryStore implements RateLimitStore {
  readonly type = 'memory' as const
  private store = new Map<string, Entry>()

  async increment(key: string, windowMs: number): Promise<RateLimitInfo> {
    const now = Date.now()
    const entry = this.store.get(key)

    if (!entry || entry.resetAt <= now) {
      const fresh: Entry = { count: 1, resetAt: now + windowMs }
      this.store.set(key, fresh)
      return fresh
    }

    entry.count++
    return entry
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key)
  }
}
