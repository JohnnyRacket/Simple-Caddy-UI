import fs from "fs/promises";
import type { ChangeAnalysis } from "./analyze";
import { dataPath, ensureDir, newId, readJson, writeFileAtomic, writeJson } from "./store";

export type Actor =
  | { kind: "ui" }
  | { kind: "mcp"; tokenId: string; tokenName: string; sessionId?: string };

export type Outcome = "applied" | "rolled_back" | "invalid" | "conflict" | "failed" | "noop";

export interface HistoryEntry {
  id: string;
  at: string;
  actor: Actor;
  summary: string;
  outcome: Outcome;
  message: string;
  beforeEtag: string;
  afterEtag?: string;
  proposalId?: string;
  analysis?: ChangeAnalysis;
  /** Response per untouched site before/after, when the health check ran */
  health?: { host: string; before: string; after: string }[];
}

const KEEP = 50;
const DIR = () => dataPath("history");

export const actorLabel = (a: Actor) => (a.kind === "ui" ? "UI" : `${a.tokenName} (MCP)`);

export async function startEntry(actor: Actor, summary: string, before: string, beforeEtag: string): Promise<HistoryEntry> {
  const entry: HistoryEntry = { id: newId("chg"), at: new Date().toISOString(), actor, summary, outcome: "failed", message: "in progress", beforeEtag };
  // Snapshot first, so a crash mid-apply still leaves a way back
  await writeFileAtomic(dataPath("history", `${entry.id}.before`), before);
  return entry;
}

export async function saveEntry(entry: HistoryEntry, after?: string): Promise<void> {
  if (after !== undefined) await writeFileAtomic(dataPath("history", `${entry.id}.after`), after);
  await writeJson(dataPath("history", `${entry.id}.json`), entry);
  await prune();
}

export async function getEntry(id: string): Promise<HistoryEntry | null> {
  if (!/^chg_[\w]+$/.test(id)) return null;
  return readJson<HistoryEntry>(dataPath("history", `${id}.json`));
}

/** The Caddyfile text before (or after) a change. */
export async function getSnapshot(id: string, which: "before" | "after"): Promise<string | null> {
  if (!/^chg_[\w]+$/.test(id)) return null;
  try {
    return await fs.readFile(dataPath("history", `${id}.${which}`), "utf-8");
  } catch {
    return null;
  }
}

export async function listEntries(limit = KEEP): Promise<HistoryEntry[]> {
  await ensureDir(DIR());
  const files = (await fs.readdir(DIR())).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, limit);
  const entries = await Promise.all(files.map((f) => readJson<HistoryEntry>(dataPath("history", f))));
  return entries.filter((e): e is HistoryEntry => e !== null);
}

async function prune() {
  const files = (await fs.readdir(DIR())).filter((f) => f.endsWith(".json")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
    const id = f.slice(0, -5);
    await Promise.all([".json", ".before", ".after"].map((ext) => fs.rm(dataPath("history", id + ext), { force: true })));
  }
}
