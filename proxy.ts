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

export function proxy(req: NextRequest) {
  const localOnly = process.env.LOCAL_ONLY !== 'false'

  if (localOnly) {
    const raw =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip')
    if (!raw) {
      console.log(`[proxy] blocked — could not determine client IP`)
      return new NextResponse('Forbidden', { status: 403 })
    }
    const ip = raw.replace(/^::ffff:/, '')

    if (!ALLOWED_RANGES.some((r) => r.test(ip))) {
      console.log(`[proxy] blocked ip=${ip}`)
      return new NextResponse('Forbidden', { status: 403 })
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
