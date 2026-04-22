import type { Context } from 'hono'

export interface RateLimitInfo {
  count: number
  resetAt: number
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<RateLimitInfo>
  reset(key: string): Promise<void>
}

export interface RateLimitOptions {
  /** Time window in milliseconds. Default: 60_000 (1 minute) */
  windowMs?: number
  /** Max requests per window. Default: 10 */
  limit?: number
  /** Derive the rate limit key from the request. Default: client IP */
  keyGenerator?: (c: Context) => string | Promise<string>
  /** Backing store. Default: MemoryStore */
  store?: RateLimitStore
  /** Response body when limit is exceeded. Default: "Too Many Requests" */
  message?: string | object | ((c: Context) => string | object | Promise<string | object>)
  /** HTTP status code when limit is exceeded. Default: 429 */
  statusCode?: number
  /** Send standard RateLimit-* headers. Default: true */
  headers?: boolean
  /** Return true to bypass rate limiting for this request */
  skip?: (c: Context) => boolean | Promise<boolean>
  /** Called when the limit is exceeded, before the response is sent */
  onLimitReached?: (c: Context) => void | Promise<void>
}
