import { NextRequest, NextResponse } from "next/server";
import { formatCaddyfile } from "@/lib/caddyfile";

const MAX_CONTENT_BYTES = 1 * 1024 * 1024; // 1 MB

export async function POST(req: NextRequest) {
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
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
