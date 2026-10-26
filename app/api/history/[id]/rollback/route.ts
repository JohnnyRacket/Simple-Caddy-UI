import { NextRequest, NextResponse } from "next/server";
import { readWithEtag } from "@/lib/caddyfile";
import { getEntry, getSnapshot } from "@/lib/history";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { safeApply } from "@/lib/safe-apply";

// Restore the Caddyfile as it was before a change, through the same safe-apply path
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(`rollback:${getClientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const { id } = await params;
  const [entry, before] = await Promise.all([getEntry(id), getSnapshot(id, "before")]);
  if (!entry || before === null) return NextResponse.json({ error: `no history entry ${id}` }, { status: 404 });
  const { etag } = await readWithEtag();
  const result = await safeApply({ content: before, baseEtag: etag, actor: { kind: "ui" }, summary: `Roll back: ${entry.summary}` });
  return NextResponse.json(result, { status: result.ok || result.outcome === "noop" ? 200 : 422 });
}
