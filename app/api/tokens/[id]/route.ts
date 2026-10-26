import { NextResponse } from "next/server";
import { revokeToken } from "@/lib/tokens";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await revokeToken(id))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "no such token" }, { status: 404 });
}
