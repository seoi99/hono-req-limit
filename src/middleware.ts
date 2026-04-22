import type { Context, MiddlewareHandler } from 'hono'
import { MemoryStore } from './store/memory'
import type { RateLimitOptions } from './types'

function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    c.req.header('x-real-ip') ??
    'unknown'
  )
}

export function rateLimitMiddleware(options: RateLimitOptions = {}): MiddlewareHandler {
  const {
    windowMs = 60_000,
    limit = 10,
    keyGenerator = getClientIp,
    store = new MemoryStore(),
    message = 'Too Many Requests',
    statusCode = 429,
    headers = true,
    skip,
    onLimitReached,
  } = options

  return async (c, next) => {
    if (skip && (await skip(c))) {
      return next()
    }

    const key = await keyGenerator(c)
    const { count, resetAt } = await store.increment(key, windowMs)
    const remaining = Math.max(0, limit - count)
    const resetSec = Math.ceil(resetAt / 1000)

    if (headers) {
      c.header('RateLimit-Limit', String(limit))
      c.header('RateLimit-Remaining', String(remaining))
      c.header('RateLimit-Reset', String(resetSec))
      c.header('RateLimit-Policy', `${limit};w=${Math.ceil(windowMs / 1000)}`)
    }

    if (count > limit) {
      if (headers) {
        c.header('Retry-After', String(Math.ceil((resetAt - Date.now()) / 1000)))
      }

      await onLimitReached?.(c)

      const body = typeof message === 'function' ? await message(c) : message
      return typeof body === 'string'
        ? c.text(body, statusCode)
        : c.json(body, statusCode)
    }

    return next()
  }
}
