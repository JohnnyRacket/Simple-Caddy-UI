import { NextRequest, NextResponse } from "next/server";
import { reloadCaddy } from "@/lib/caddyfile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`reload:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    await reloadCaddy();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[api/caddy/reload] error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
