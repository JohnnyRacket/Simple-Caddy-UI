import { NextRequest, NextResponse } from "next/server";
import { applyProposal, decide, ProposalError } from "@/lib/proposals";

// A human decision from the Changes page. Approving applies right away.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { decision } = await req.json();
    if (decision !== "approve" && decision !== "reject") {
      return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
    }
    if (decision === "reject") {
      return NextResponse.json({ proposal: await decide(id, "rejected", "ui") });
    }
    const approved = await decide(id, "approved", "ui");
    const { proposal, result } = await applyProposal(id, approved.actor);
    return NextResponse.json({ proposal, result }, { status: result.ok || result.outcome === "noop" ? 200 : 422 });
  } catch (err: unknown) {
    const status = err instanceof ProposalError ? 409 : 500;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
