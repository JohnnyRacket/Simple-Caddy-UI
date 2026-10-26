import { NextRequest, NextResponse } from "next/server";
import { readCaddyfile, validateContent } from "@/lib/caddyfile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const MAX_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MB

// Validates the posted text (the editor's content), or the live file when none is sent
export async function POST(req: NextRequest) {
  if (!checkRateLimit(`validate:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const content = typeof body?.content === "string" ? body.content : await readCaddyfile();
    if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
      return NextResponse.json({ error: "Content too large (max 1 MB)" }, { status: 413 });
    }
    const result = await validateContent(content);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
