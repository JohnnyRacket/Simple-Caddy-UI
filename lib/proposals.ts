import fs from "fs/promises";
import type { ChangeAnalysis } from "./analyze";
import type { Actor } from "./history";
import { preview, safeApply, type ApplyResult } from "./safe-apply";
import { dataPath, ensureDir, newId, readJson, withLock, writeJson } from "./store";

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed" | "expired";

export interface Proposal {
  id: string;
  createdAt: string;
  expiresAt: string;
  actor: Actor;
  summary: string;
  baseEtag: string;
  content: string;
  analysis: ChangeAnalysis;
  validation: string;
  status: ProposalStatus;
  decidedAt?: string;
  /** Where the human decision came from */
  decidedVia?: "ui" | "chat";
  historyId?: string;
  result?: string;
}

const TTL_MS = 30 * 60_000;
const KEEP_MS = 7 * 24 * 3600_000;
const DIR = () => dataPath("proposals");
const file = (id: string) => dataPath("proposals", `${id}.json`);
const validId = (id: string) => /^prp_[\w]+$/.test(id);

export class ProposalError extends Error {}

export async function createProposal(content: string, baseEtag: string | undefined, actor: Actor, summary: string): Promise<{ proposal?: Proposal; errors: string[] }> {
  const p = await preview(content, baseEtag, { guardImports: actor.kind === "mcp" });
  if (!p.ok || !p.analysis) return { errors: p.errors };
  if (p.analysis.changedLines === 0) return { errors: ["no changes: the proposed content matches the live Caddyfile"] };
  const now = Date.now();
  const proposal: Proposal = {
    id: newId("prp"),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + TTL_MS).toISOString(),
    actor,
    summary: summary.trim().slice(0, 300) || "(no summary)",
    baseEtag: p.baseEtag,
    content,
    analysis: p.analysis,
    validation: p.validation ?? "",
    status: "pending",
  };
  await writeJson(file(proposal.id), proposal);
  return { proposal, errors: [] };
}

export async function getProposal(id: string): Promise<Proposal | null> {
  if (!validId(id)) return null;
  const p = await readJson<Proposal>(file(id));
  if (p && (p.status === "pending" || p.status === "approved") && Date.parse(p.expiresAt) < Date.now()) {
    p.status = "expired";
    await writeJson(file(id), p);
  }
  return p;
}

export async function listProposals(): Promise<Proposal[]> {
  await ensureDir(DIR());
  const files = (await fs.readdir(DIR())).filter((f) => f.endsWith(".json")).sort().reverse();
  const out: Proposal[] = [];
  for (const f of files) {
    const p = await getProposal(f.slice(0, -5));
    if (!p) continue;
    if (Date.now() - Date.parse(p.createdAt) > KEEP_MS) {
      await fs.rm(file(p.id), { force: true });
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Record a human decision. Only pending proposals can be decided. */
export async function decide(id: string, decision: "approved" | "rejected", via: "ui" | "chat"): Promise<Proposal> {
  return withLock(`proposal:${id}`, async () => {
    const p = await getProposal(id);
    if (!p) throw new ProposalError(`no proposal ${id}`);
    if (p.status !== "pending") throw new ProposalError(`proposal ${id} is ${p.status}, not pending`);
    p.status = decision;
    p.decidedAt = new Date().toISOString();
    p.decidedVia = via;
    await writeJson(file(id), p);
    return p;
  });
}

/** Apply an approved proposal: exactly its text, against exactly the version it was based on. */
export async function applyProposal(id: string, actor: Actor): Promise<{ proposal: Proposal; result: ApplyResult }> {
  return withLock(`proposal:${id}`, async () => {
    const p = await getProposal(id);
    if (!p) throw new ProposalError(`no proposal ${id}`);
    if (p.status !== "approved") throw new ProposalError(`proposal ${id} is ${p.status}; it must be approved first`);
    const result = await safeApply({ content: p.content, baseEtag: p.baseEtag, actor, summary: p.summary, proposalId: p.id });
    p.status = result.ok || result.outcome === "noop" ? "applied" : "failed";
    p.historyId = result.historyId;
    p.result = result.message;
    await writeJson(file(id), p);
    return { proposal: p, result };
  });
}
