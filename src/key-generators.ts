import type { Context } from 'hono'

/** Returns the client IP from X-Forwarded-For or X-Real-IP headers. */
export function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    c.req.header('x-real-ip') ??
    'unknown'
  )
}

/**
 * Rate-limit by a request header value (e.g. an API key or user ID passed as a header).
 * Falls back to client IP when the header is absent.
 *
 * @example
 * rateLimit({ keyGenerator: keyByHeader('x-api-key') })
 */
export function keyByHeader(headerName: string): (c: Context) => string {
  return (c) => c.req.header(headerName) ?? getClientIp(c)
}

/**
 * Rate-limit by a value extracted from Hono's context variables (e.g. an authenticated user ID).
 * Falls back to client IP when the extractor returns null/undefined.
 *
 * @example
 * rateLimit({ keyGenerator: keyByContext((c) => c.get('user')?.id) })
 */
export function keyByContext<T extends Record<string, unknown>>(
  extract: (c: Context<{ Variables: T }>) => string | null | undefined,
): (c: Context) => string {
  return (c) => extract(c as Context<{ Variables: T }>) ?? getClientIp(c)
}
