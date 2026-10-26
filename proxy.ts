import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, safeEqual, sessionValue } from '@/lib/auth'
import { getClientIp } from '@/lib/rate-limit'

const ALLOWED_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i, // IPv6 ULA (fc00::/7)
]

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Cookies are sent on same-site requests, and other ports on this host or
// sibling subdomains count as same-site, so SameSite alone doesn't stop CSRF.
// Browsers only send Sec-Fetch-Site to HTTPS/localhost, so over plain HTTP on
// the LAN this falls back to Origin.
function isCrossOrigin(req: NextRequest): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = req.headers.get('origin')
  if (!origin) return false // not a browser; no ambient cookie to abuse
  try {
    return new URL(origin).host !== req.headers.get('host')
  } catch {
    return true
  }
}

export function proxy(req: NextRequest) {
  const localOnly = process.env.LOCAL_ONLY !== 'false'

  if (localOnly) {
    // server.mjs pins x-forwarded-for to the real peer (or a TRUSTED_PROXIES hop)
    const ip = getClientIp(req)
    if (!ALLOWED_RANGES.some((r) => r.test(ip))) {
      console.log(`[proxy] blocked ip=${ip}`)
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  if (!SAFE_METHODS.has(req.method) && isCrossOrigin(req)) {
    console.log(
      `[proxy] blocked cross-origin ${req.method} ${req.nextUrl.pathname}` +
        ` origin=${req.headers.get('origin')} sec-fetch-site=${req.headers.get('sec-fetch-site')} host=${req.headers.get('host')}`,
    )
    return new NextResponse('Forbidden', { status: 403 })
  }

  const secret = process.env.SECRET_TOKEN
  if (!secret) {
    if (process.env.DISABLE_AUTH === 'true') return NextResponse.next()
    console.error('[proxy] SECRET_TOKEN is not set — refusing requests (set DISABLE_AUTH=true to opt out)')
    return new NextResponse('SECRET_TOKEN is not configured', { status: 503 })
  }

  const { pathname } = req.nextUrl
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/')
  ) {
    return NextResponse.next()
  }

  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const cookie = req.cookies.get(AUTH_COOKIE)?.value
  const authorized =
    (bearer !== undefined && safeEqual(bearer, secret)) ||
    (cookie !== undefined && safeEqual(cookie, sessionValue(secret)))

  if (!authorized) {
    console.log(`[proxy] unauthorized — token missing or invalid`)
    if (pathname.startsWith('/api/')) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.search = ''
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}
