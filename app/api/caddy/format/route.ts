import { NextRequest, NextResponse } from "next/server";
import { formatCaddyfile } from "@/lib/caddyfile";

export async function POST(req: NextRequest) {
  try {
    const { content } = await req.json();
    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
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
