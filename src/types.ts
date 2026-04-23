import type { Context } from 'hono'
import { ContentfulStatusCode } from 'hono/utils/http-status'

export type Algorithm = 'fixed-window' | 'token-bucket'

export interface RedisLike {
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>
  del(key: string): Promise<unknown>
  ping(): Promise<string>
}

export interface RateLimitInfo {
  count: number
  resetAt: number
}

export interface RateLimitStore {
  readonly type: string
  ping?(): Promise<boolean>
  block?(key: string, durationMs: number): Promise<void>
  isBlocked?(key: string): Promise<number | false>
  increment(key: string, windowMs: number, limit: number): Promise<RateLimitInfo>
  reset(key: string): Promise<void>
}

export interface RateLimitOptions {
  /** Time window in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number
  /** Max requests per window. Default: 10 */
  limit?: number
  /** Derive the rate limit key from the request. Default: client IP */
  keyGenerator?: (c: Context) => string | Promise<string>
  /** Rate limiting algorithm. Default: fixed-window. Ignored when store is provided explicitly. */
  algorithm?: Algorithm
  /** Backing store. Default: MemoryStore */
  store?: RateLimitStore
  /** Duration in ms to block a client after exceeding the limit. Default: disabled */
  blockDuration?: number
  /** Response body when limit is exceeded. Default: "Too Many Requests" */
  message?: string | object | ((c: Context) => string | object | Promise<string | object>)
  /** HTTP status code when limit is exceeded. Default: 429 */
  statusCode?: ContentfulStatusCode
  /** Send standard RateLimit-* headers. Default: true */
  headers?: boolean
  /** Return true to bypass rate limiting for this request */
  skip?: (c: Context) => boolean | Promise<boolean>
  /** Called when the limit is exceeded, before the response is sent */
  onLimitReached?: (c: Context) => void | Promise<void>
}
