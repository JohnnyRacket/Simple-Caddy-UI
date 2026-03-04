import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
  const host = req.headers.get("host") ?? "localhost:3000"
  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const url = new URL(`${proto}://${host}/login`)
  const res = NextResponse.redirect(url)
  res.cookies.delete("__auth")
  return res
}
