import { NextRequest } from "next/server"
import { AUTH_COOKIE, safeEqual, seeOther, sessionValue } from "@/lib/auth"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  const secret = process.env.SECRET_TOKEN
  if (!secret) {
    return seeOther("/editor")
  }

  // Rate limit: 10 attempts per 15 minutes per IP
  if (!checkRateLimit(`auth:${getClientIp(req)}`, 10, 15 * 60_000)) {
    return seeOther("/login?error=1")
  }

  const form = await req.formData()
  const token = form.get("token")

  if (typeof token !== "string" || !safeEqual(token, secret)) {
    return seeOther("/login?error=1")
  }

  const res = seeOther("/editor")
  const cookie = [
    `${AUTH_COOKIE}=${sessionValue(secret)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=604800", // 7 days
  ]
  if (req.headers.get("x-forwarded-proto") === "https") cookie.push("Secure")
  res.headers.append("Set-Cookie", cookie.join("; "))
  return res
}
