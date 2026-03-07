import { networkInterfaces } from 'os'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i, // IPv6 ULA (fc00::/7)
]

// Derive /64 prefixes from the server's own non-loopback IPv6 addresses.
// Any client sharing a /64 prefix is on the same LAN segment.
function getLanPrefixes(): string[] {
  const prefixes: string[] = []
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv6' && !addr.internal) {
        const groups = addr.address.split(':')
        if (groups.length >= 4) {
          prefixes.push(groups.slice(0, 4).join(':') + ':')
        }
      }
    }
  }
  return prefixes
}

const LAN_PREFIXES = getLanPrefixes()

function isAllowed(ip: string): boolean {
  if (ALLOWED_RANGES.some((r) => r.test(ip))) return true
  if (LAN_PREFIXES.some((prefix) => ip.startsWith(prefix))) return true
  const extra = (process.env.ALLOWED_EXTRA ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return extra.some((prefix) => ip.startsWith(prefix))
}

export function proxy(req: NextRequest) {
  const localOnly = process.env.LOCAL_ONLY !== 'false'

  if (localOnly) {
    const raw =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip')

    if (!raw) {
      console.warn('[proxy] could not determine client IP (no proxy headers) — allowing through')
      // fall through to auth check
    } else {
      const ip = raw.replace(/^::ffff:/, '')
      if (!isAllowed(ip)) {
        console.log(`[proxy] blocked ip=${ip}`)
        return new NextResponse('Forbidden', { status: 403 })
      }
    }
  }

  const secret = process.env.SECRET_TOKEN
  if (secret) {
    const { pathname } = req.nextUrl
    if (
      pathname.startsWith('/login') ||
      pathname.startsWith('/api/auth/') ||
      pathname.startsWith('/_next/')
    ) {
      return NextResponse.next()
    }

    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    const cookie = req.cookies.get('__auth')?.value
    if (bearer !== secret && cookie !== secret) {
      console.log(`[proxy] unauthorized — token missing or invalid`)
      if (pathname.startsWith('/api/')) {
        return new NextResponse('Unauthorized', { status: 401 })
      }
      const loginUrl = req.nextUrl.clone()
      loginUrl.pathname = '/login'
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}
