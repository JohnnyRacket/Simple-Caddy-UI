import { AUTH_COOKIE, seeOther } from "@/lib/auth"

export async function POST() {
  const res = seeOther("/login")
  res.headers.append("Set-Cookie", `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
  return res
}
