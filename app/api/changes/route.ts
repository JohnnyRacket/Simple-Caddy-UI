import { NextResponse } from "next/server";
import { listEntries } from "@/lib/history";
import { listProposals } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [proposals, history] = await Promise.all([listProposals(), listEntries()]);
    // The UI shows the diff; the full proposed text stays server-side
    return NextResponse.json({ proposals: proposals.map((p) => ({ ...p, content: undefined })), history });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
