import { NextRequest, NextResponse } from "next/server";
import { createToken, listTokens } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export async function GET() {
  const tokens = await listTokens();
  return NextResponse.json({ tokens: tokens.map((t) => ({ ...t, hash: undefined })) });
}

export async function POST(req: NextRequest) {
  try {
    const { name, scope } = await req.json();
    if (typeof name !== "string" || (scope !== "read" && scope !== "write")) {
      return NextResponse.json({ error: "name and scope (read or write) are required" }, { status: 400 });
    }
    const { token, record } = await createToken(name, scope);
    // The only time the token itself is returned
    return NextResponse.json({ token, record: { ...record, hash: undefined } }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
