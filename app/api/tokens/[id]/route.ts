import { NextResponse } from "next/server";
import { revokeToken, setApproval } from "@/lib/tokens";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { approval } = await req.json().catch(() => ({}));
  if (approval !== "chat" && approval !== "client") {
    return NextResponse.json({ error: "approval must be chat or client" }, { status: 400 });
  }
  const rec = await setApproval(id, approval);
  return rec ? NextResponse.json({ token: { ...rec, hash: undefined } }) : NextResponse.json({ error: "no such token" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await revokeToken(id))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "no such token" }, { status: 404 });
}
