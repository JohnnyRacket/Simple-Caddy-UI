import { NextRequest, NextResponse } from "next/server";
import { readCaddyfile, saveCaddyfile } from "@/lib/caddyfile";

export async function GET() {
  try {
    const content = await readCaddyfile();
    return NextResponse.json({ content });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { content } = await req.json();
    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }
    await saveCaddyfile(content);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
