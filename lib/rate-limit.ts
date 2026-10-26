// Simple in-memory sliding window rate limiter.
// Suitable for single-process Node.js deployments.

const windows = new Map<string, number[]>()
const MAX_KEYS = 10_000

/**
 * Returns true if the request should be allowed, false if the limit is exceeded.
 * @param key     Unique key per caller, e.g. `${route}:${ip}`
 * @param max     Maximum requests allowed within the window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const cutoff = now - windowMs
  if (windows.size > MAX_KEYS) prune(cutoff)
  const hits = (windows.get(key) ?? []).filter((t) => t > cutoff)
  if (hits.length >= max) return false
  hits.push(now)
  windows.set(key, hits)
  return true
}

// Keep memory bounded: drop keys with no hits inside the window
function prune(cutoff: number) {
  for (const [key, hits] of windows) {
    if (hits[hits.length - 1] <= cutoff) windows.delete(key)
  }
}

/** Client IP as pinned by server.mjs (real TCP peer, or the last TRUSTED_PROXIES hop). */
export function getClientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? 'unknown').replace(/^::ffff:/, '')
}
