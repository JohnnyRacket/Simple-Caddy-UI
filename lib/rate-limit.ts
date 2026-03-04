// Simple in-memory sliding window rate limiter.
// Suitable for single-process Node.js deployments.

const windows = new Map<string, number[]>()

/**
 * Returns true if the request should be allowed, false if the limit is exceeded.
 * @param key     Unique key per caller, e.g. `${route}:${ip}`
 * @param max     Maximum requests allowed within the window
 * @param windowMs Window duration in milliseconds
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const cutoff = now - windowMs
  const hits = (windows.get(key) ?? []).filter((t) => t > cutoff)
  if (hits.length >= max) return false
  hits.push(now)
  windows.set(key, hits)
  return true
}

/** Extract a best-effort client IP from request headers (mirrors proxy.ts logic). */
export function getClientIp(req: Request): string {
  const raw =
    (req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip')) ||
    'unknown'
  return raw.replace(/^::ffff:/, '')
}
