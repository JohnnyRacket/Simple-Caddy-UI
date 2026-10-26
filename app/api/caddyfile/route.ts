import { NextRequest, NextResponse } from "next/server";
import { readWithEtag } from "@/lib/caddyfile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { safeApply } from "@/lib/safe-apply";

export async function GET() {
  try {
    return NextResponse.json(await readWithEtag());
  } catch (err: unknown) {
    console.error("[api/caddyfile] read error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

const MAX_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MB

// Save = validate, write, reload, health-check, roll back on failure (lib/safe-apply.ts)
export async function POST(req: NextRequest) {
  if (!checkRateLimit(`caddyfile:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const { content, etag, summary } = await req.json();
    if (typeof content !== "string" || typeof etag !== "string") {
      return NextResponse.json({ error: "content and etag must be strings" }, { status: 400 });
    }
    if (Buffer.byteLength(content, "utf-8") > MAX_CONTENT_BYTES) {
      return NextResponse.json({ error: "Content too large (max 1 MB)" }, { status: 413 });
    }
    const result = await safeApply({
      content,
      baseEtag: etag,
      actor: { kind: "ui" },
      summary: typeof summary === "string" && summary.trim() ? summary.trim().slice(0, 300) : "Saved from the editor",
    });
    const status = result.ok || result.outcome === "noop" ? 200 : result.outcome === "conflict" ? 409 : 422;
    return NextResponse.json(result, { status });
  } catch (err: unknown) {
    console.error("[api/caddyfile] save error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
