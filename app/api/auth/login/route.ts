import { NextRequest, NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"

function hostUrl(req: NextRequest, pathname: string, search = "") {
  const host = req.headers.get("host") ?? "localhost:3000"
  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const url = new URL(`${proto}://${host}`)
  url.pathname = pathname
  url.search = search
  return url
}

export async function POST(req: NextRequest) {
  const secret = process.env.SECRET_TOKEN
  if (!secret) {
    return NextResponse.redirect(hostUrl(req, "/editor"))
  }

  // Rate limit: 10 attempts per 15 minutes per IP
  if (!checkRateLimit(`auth:${getClientIp(req)}`, 10, 15 * 60_000)) {
    return NextResponse.redirect(hostUrl(req, "/login", "?error=1"))
  }

  const form = await req.formData()
  const token = form.get("token")

  if (typeof token !== "string") {
    return NextResponse.redirect(hostUrl(req, "/login", "?error=1"))
  }

  // Use timing-safe comparison to prevent timing attacks
  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(secret)
  const valid =
    tokenBuf.length === secretBuf.length &&
    timingSafeEqual(tokenBuf, secretBuf)

  if (!valid) {
    return NextResponse.redirect(hostUrl(req, "/login", "?error=1"))
  }

  const res = NextResponse.redirect(hostUrl(req, "/editor"))
  res.cookies.set("__auth", secret, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    // No maxAge — session cookie; expires when browser closes
  })
  return res
}
