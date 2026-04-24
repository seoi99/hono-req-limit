import type { Context, MiddlewareHandler } from 'hono'
import { MemoryStore } from './store/memory'
import type { Algorithm, RateLimitOptions, RateLimitStore } from './types'
import { getClientIp } from './key-generators'

function createDefaultStore(algorithm: Algorithm): RateLimitStore {
  return new MemoryStore({ algorithm })
}

export function rateLimitMiddleware(options: RateLimitOptions = {}): MiddlewareHandler {
  const {
    windowMs = 60_000,
    limit = 10,
    keyGenerator = getClientIp,
    algorithm = 'fixed-window',
    blockDuration,
    message = 'Too Many Requests',
    statusCode = 429,
    headers = true,
    skip,
    onLimitReached,
  } = options

  const store: RateLimitStore = options.store ?? createDefaultStore(algorithm)
  let connectionVerified = !store.ping

  return async (c, next) => {
    if (!connectionVerified) {
      const ok = await store.ping!()
      if (!ok) throw new Error(`[hono-req-limit] ${store.type} store connection check failed`)
      connectionVerified = true
    }

    if (skip && (await skip(c))) {
      return next()
    }

    const key = await keyGenerator(c)

    // Block check — short-circuit before counting if client is in penalty period
    if (blockDuration && store.isBlocked) {
      const blockedUntil = await store.isBlocked(key)
      if (blockedUntil !== false) {
        if (headers) {
          c.header('Retry-After', String(Math.ceil((blockedUntil - Date.now()) / 1000)))
        }
        const body = typeof message === 'function' ? await message(c) : message
        return typeof body === 'string'
          ? c.text(body, statusCode)
          : c.json(body, statusCode)
      }
    }

    const { count, resetAt } = await store.increment(key, windowMs, limit)
    const remaining = Math.max(0, limit - count)
    const resetSec = Math.ceil(resetAt / 1000)

    if (headers) {
      c.header('RateLimit-Limit', String(limit))
      c.header('RateLimit-Remaining', String(remaining))
      c.header('RateLimit-Reset', String(resetSec))
      c.header('RateLimit-Policy', `${limit};w=${Math.ceil(windowMs / 1000)}`)
    }

    if (count > limit) {
      if (blockDuration && store.block) {
        await store.block(key, blockDuration)
      }

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
