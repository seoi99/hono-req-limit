# hono-req-limit

Rate limiting middleware for [Hono](https://hono.dev). Supports fixed-window and token-bucket algorithms, in-memory and Redis stores, and per-user key generators.

## Installation

```bash
npm install hono-req-limit
# or
pnpm add hono-req-limit
```

Redis support requires [ioredis](https://github.com/redis/ioredis) as an optional peer dependency:

```bash
pnpm add ioredis
```

## Quick start

```ts
import { Hono } from 'hono'
import { rateLimit } from 'hono-req-limit'

const app = new Hono()

app.use('*', rateLimit({ limit: 100, windowMs: 60_000 }))

app.get('/', (c) => c.text('Hello!'))
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `limit` | `number` | `10` | Max requests allowed per window |
| `windowMs` | `number` | `60_000` | Window duration in milliseconds |
| `algorithm` | `'fixed-window' \| 'token-bucket'` | `'fixed-window'` | Rate limiting algorithm. Ignored when `store` is provided explicitly |
| `store` | `RateLimitStore` | `MemoryStore` | Backing store |
| `keyGenerator` | `(c: Context) => string \| Promise<string>` | Client IP | Function to derive the rate limit key |
| `blockDuration` | `number` | disabled | Duration (ms) to block a client after exceeding the limit |
| `message` | `string \| object \| (c) => string \| object` | `'Too Many Requests'` | Response body when the limit is exceeded |
| `statusCode` | `number` | `429` | HTTP status code when the limit is exceeded |
| `headers` | `boolean` | `true` | Send standard `RateLimit-*` headers |
| `skip` | `(c: Context) => boolean \| Promise<boolean>` | — | Return `true` to bypass rate limiting for the request |
| `onLimitReached` | `(c: Context) => void \| Promise<void>` | — | Called when the limit is exceeded, before the response is sent |

## Algorithms

### Fixed window (default)

Counts requests in fixed time slots. Simple and cheap — each key is one counter and a reset timestamp.

```ts
app.use('*', rateLimit({
  algorithm: 'fixed-window',
  limit: 100,
  windowMs: 60_000,
}))
```

### Token bucket

A bucket starts full and refills at a constant rate. Allows short bursts while enforcing a sustained average rate.

```ts
app.use('*', rateLimit({
  algorithm: 'token-bucket',
  limit: 100,      // bucket capacity
  windowMs: 60_000, // time to fully refill from empty
}))
```

## Stores

### MemoryStore (default)

In-process store. Works out of the box with no dependencies. Not shared across multiple processes or instances.

```ts
import { MemoryStore } from 'hono-req-limit'

app.use('*', rateLimit({
  store: new MemoryStore({
    algorithm: 'token-bucket',   // default: 'fixed-window'
    cleanupIntervalMs: 300_000,  // default: 5 min. Pass 0 to disable
  }),
  limit: 100,
  windowMs: 60_000,
}))
```

Call `store.destroy()` to clear the background cleanup timer when the store is no longer needed.

### RedisStore

Atomic Redis-backed store via Lua scripts. Works across multiple processes and instances.

```ts
import Redis from 'ioredis'
import { RedisStore } from 'hono-req-limit'

const redis = new Redis()

app.use('*', rateLimit({
  store: new RedisStore(redis, { algorithm: 'fixed-window' }),
  limit: 100,
  windowMs: 60_000,
}))
```

`RedisStore` accepts any client that implements the `RedisLike` interface (`eval`, `del`, `ping`), so it works with custom ioredis configurations including Cluster and Sentinel.

### Custom store

Implement `RateLimitStore` to use any backend:

```ts
import type { RateLimitStore, RateLimitInfo } from 'hono-req-limit'

class MyStore implements RateLimitStore {
  readonly type = 'my-store'

  async increment(key: string, windowMs: number, limit: number): Promise<RateLimitInfo> {
    // ...
  }

  async reset(key: string): Promise<void> {
    // ...
  }
}
```

## Key generators

By default, requests are keyed by client IP (read from `X-Forwarded-For` or `X-Real-IP`).

### Key by request header

Rate-limit by an API key or session token passed in a header. Falls back to client IP when the header is absent.

```ts
import { keyByHeader } from 'hono-req-limit'

app.use('/api/*', rateLimit({
  keyGenerator: keyByHeader('x-api-key'),
  limit: 1000,
  windowMs: 60_000,
}))
```

### Key by authenticated user

Rate-limit by a value stored in Hono's context variables (e.g. an authenticated user ID set by an auth middleware).

```ts
import { keyByContext } from 'hono-req-limit'

app.use('/api/*', rateLimit({
  keyGenerator: keyByContext((c) => c.get('user')?.id),
  limit: 200,
  windowMs: 60_000,
}))
```

### Custom key generator

```ts
app.use('*', rateLimit({
  keyGenerator: (c) => c.req.header('cf-connecting-ip') ?? 'unknown',
}))
```

The default `getClientIp` helper is exported if you need it as a fallback:

```ts
import { getClientIp } from 'hono-req-limit'

app.use('*', rateLimit({
  keyGenerator: (c) => c.get('user')?.id ?? getClientIp(c),
}))
```

## Block duration

After a client exceeds the limit, block them for an additional penalty period regardless of whether the window resets.

```ts
app.use('*', rateLimit({
  limit: 10,
  windowMs: 60_000,
  blockDuration: 10 * 60_000, // block for 10 minutes after exceeding the limit
}))
```

Blocked requests receive a `Retry-After` header indicating when the block lifts.

## Response headers

When `headers: true` (the default), every response includes:

| Header | Value |
|---|---|
| `RateLimit-Limit` | The configured `limit` |
| `RateLimit-Remaining` | Requests left in the current window |
| `RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `RateLimit-Policy` | e.g. `100;w=60` |
| `Retry-After` | Seconds until the client can retry (only on 429 responses) |

## Skip and hooks

```ts
app.use('*', rateLimit({
  limit: 100,
  windowMs: 60_000,

  // Bypass rate limiting (e.g. for internal health checks)
  skip: (c) => c.req.path === '/healthz',

  // Log or alert when a client hits the limit
  onLimitReached: (c) => {
    console.warn('Rate limit exceeded:', c.req.header('x-forwarded-for'))
  },
}))
```

## Custom message

```ts
// String
app.use('*', rateLimit({ message: 'Slow down, please.' }))

// JSON object
app.use('*', rateLimit({ message: { error: 'rate_limited', retryAfter: 60 } }))

// Dynamic (based on request context)
app.use('*', rateLimit({
  message: (c) => ({ error: 'rate_limited', path: c.req.path }),
}))
```

## Proxy trust note

The default `getClientIp` reads the first IP from `X-Forwarded-For`. If your app is not behind a trusted reverse proxy, clients can spoof this header. In that case, provide a `keyGenerator` that reads the actual connection IP from a header your proxy sets and clients cannot override (e.g. `CF-Connecting-IP` for Cloudflare).

## License

MIT
