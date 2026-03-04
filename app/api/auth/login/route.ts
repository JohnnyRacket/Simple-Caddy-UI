import { NextRequest, NextResponse } from "next/server"

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

  const form = await req.formData()
  const token = form.get("token")

  if (typeof token !== "string" || token !== secret) {
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
