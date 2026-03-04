import { NextRequest, NextResponse } from "next/server";
import { formatCaddyfile } from "@/lib/caddyfile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const MAX_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MB

export async function POST(req: NextRequest) {
  if (!checkRateLimit(`format:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const { content } = await req.json();
    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }
    if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
      return NextResponse.json({ error: "Content too large (max 1 MB)" }, { status: 413 });
    }
    const formatted = await formatCaddyfile(content);
    return NextResponse.json({ content: formatted });
  } catch (err: unknown) {
    console.error("[api/caddy/format] error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
