import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fe80:/i,
]

export function proxy(req: NextRequest) {
  const localOnly = process.env.LOCAL_ONLY !== 'false'

  if (localOnly) {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      '127.0.0.1'

    if (!ALLOWED_RANGES.some((r) => r.test(ip))) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  return NextResponse.next()
}
