import type { Algorithm, RateLimitInfo, RateLimitStore, RedisLike } from '../types'

export interface RedisStoreOptions {
  algorithm?: Algorithm
}

// Fixed-window: atomically INCR, set PEXPIRE on first request, return [count, pttl]
const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`

// Token-bucket: atomic read-refill-consume via HASH, return [allowed, count, resetAt]
const TOKEN_BUCKET_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'lastRefill')
local prevTokens = tonumber(bucket[1]) or capacity
local prevRefill = tonumber(bucket[2]) or now
local refilled = math.min(capacity, prevTokens + (now - prevRefill) * refillRate)
local ttlMs = math.ceil(capacity / refillRate)
if refilled >= 1 then
  local tokens = refilled - 1
  redis.call('HMSET', KEYS[1], 'tokens', tokens, 'lastRefill', now)
  redis.call('PEXPIRE', KEYS[1], ttlMs)
  local count = capacity - math.floor(tokens)
  local msUntilFull = math.ceil((capacity - tokens) / refillRate)
  return {1, count, now + msUntilFull}
else
  redis.call('HMSET', KEYS[1], 'tokens', refilled, 'lastRefill', now)
  redis.call('PEXPIRE', KEYS[1], ttlMs)
  local msUntilToken = math.ceil((1 - refilled) / refillRate)
  return {0, capacity + 1, now + msUntilToken}
end
`

const BLOCK_SCRIPT = `return redis.call('SET', KEYS[1], 1, 'PX', ARGV[1])`
const IS_BLOCKED_SCRIPT = `return redis.call('PTTL', KEYS[1])`

export class RedisStore implements RateLimitStore {
  readonly type = 'redis' as const
  private readonly algorithm: Algorithm

  constructor(private client: RedisLike, { algorithm = 'fixed-window' }: RedisStoreOptions = {}) {
    this.algorithm = algorithm
  }

  async increment(key: string, windowMs: number, limit: number): Promise<RateLimitInfo> {
    return this.algorithm === 'token-bucket'
      ? this.tokenBucketIncrement(key, windowMs, limit)
      : this.fixedWindowIncrement(key, windowMs)
  }

  private async fixedWindowIncrement(key: string, windowMs: number): Promise<RateLimitInfo> {
    const result = await this.client.eval(FIXED_WINDOW_SCRIPT, 1, key, windowMs) as [number, number]
    const [count, pttl] = result
    return { count, resetAt: Date.now() + Math.max(pttl, 0) }
  }

  private async tokenBucketIncrement(key: string, windowMs: number, limit: number): Promise<RateLimitInfo> {
    const refillRate = limit / windowMs
    const now = Date.now()
    const result = await this.client.eval(TOKEN_BUCKET_SCRIPT, 1, key, limit, refillRate, now) as [number, number, number]
    const [, count, resetAt] = result
    return { count, resetAt }
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

  async block(key: string, durationMs: number): Promise<void> {
    await this.client.eval(BLOCK_SCRIPT, 1, `${key}:blocked`, durationMs)
  }

  async isBlocked(key: string): Promise<number | false> {
    const pttl = await this.client.eval(IS_BLOCKED_SCRIPT, 1, `${key}:blocked`) as number
    return pttl > 0 ? Date.now() + pttl : false
  }
}
