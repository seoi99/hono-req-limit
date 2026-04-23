import type { RateLimitInfo, RateLimitStore, RedisLike } from '../types'

// Atomically INCR, set PEXPIRE on first request, return [count, pttl]
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`

export class RedisStore implements RateLimitStore {
  readonly type = 'redis' as const
  constructor(private client: RedisLike) {}

  async increment(key: string, windowMs: number): Promise<RateLimitInfo> {
    const result = await this.client.eval(INCREMENT_SCRIPT, 1, key, windowMs) as [number, number]
    const [count, pttl] = result
    return {
      count,
      resetAt: Date.now() + Math.max(pttl, 0),
    }
  }

  async reset(key: string): Promise<void> {
    await this.client.del(key)
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping()
      return true
    } catch {
      return false
    }
  }
}
