import http from "http";
import { analyzeChange, checkControl, checkImports, firstDifference, siteMap, type ChangeAnalysis } from "./analyze";
import type { CaddyJson } from "./caddyfile";
import { adaptContent, etagOf, readWithEtag, reloadCaddy, validateContent, writeCaddyfile } from "./caddyfile";
import { runCommand } from "./exec";
import { saveEntry, startEntry, type Actor, type HistoryEntry, type Outcome } from "./history";
import { probeHosts } from "./probe";
import { withLock } from "./store";

const SYSTEMCTL_BIN = process.env.SYSTEMCTL_BIN ?? "/bin/systemctl";
const SETTLE_MS = Number(process.env.APPLY_SETTLE_MS ?? 1500);
const RETRY_MS = Number(process.env.APPLY_RETRY_MS ?? 4000);
const ADMIN_URL = (process.env.CADDY_ADMIN_URL ?? "http://127.0.0.1:2019").replace(/\/$/, "");

export interface ApplyRequest {
  content: string;
  /** ETag of the version the change was based on; mismatch → conflict */
  baseEtag: string;
  actor: Actor;
  summary: string;
  proposalId?: string;
}

export interface ApplyResult {
  ok: boolean;
  outcome: Outcome;
  message: string;
  historyId?: string;
  etag: string;
  analysis?: ChangeAnalysis;
}

export interface Preview {
  ok: boolean;
  /** Problems that block the change (validation, import guard, conflicts) */
  errors: string[];
  validation?: string;
  analysis?: ChangeAnalysis;
  baseEtag: string;
}

/** Validate and analyze a candidate against the live file, without writing anything. */
export async function preview(content: string, baseEtag: string | undefined, opts: { guardImports: boolean }): Promise<Preview> {
  const current = await readWithEtag();
  const errors: string[] = [];
  if (baseEtag && baseEtag !== current.etag) {
    errors.push("conflict: the Caddyfile changed since it was read; read it again and redo the change");
  }
  if (opts.guardImports) errors.push(...checkImports(content));
  if (errors.length) return { ok: false, errors, baseEtag: current.etag };

  const validation = await validateContent(content);
  if (!validation.ok) return { ok: false, errors: [validation.output], validation: validation.output, baseEtag: current.etag };

  const [oldJson, newJson] = await Promise.all([adaptContent(current.content), adaptContent(content)]);
  const control = checkControl(oldJson, newJson);
  if (control.length) return { ok: false, errors: control, validation: validation.output, baseEtag: current.etag };
  const analysis = analyzeChange(current.content, content, siteMap(oldJson, current.content), siteMap(newJson, content));
  return { ok: true, errors: [], validation: validation.output, analysis, baseEtag: current.etag };
}

/**
 * The one path every Caddyfile write takes: check the base version, validate
 * the candidate, snapshot, record how every untouched site answers, write,
 * reload, and confirm those sites still answer the same. Any failure restores
 * the previous file and reloads it.
 */
export async function safeApply(req: ApplyRequest): Promise<ApplyResult> {
  return withLock("caddyfile", async () => {
    const current = await readWithEtag();
    if (current.etag !== req.baseEtag) {
      return { ok: false, outcome: "conflict", message: "The Caddyfile changed since this change was prepared; nothing was written.", etag: current.etag };
    }
    if (current.content === req.content) {
      return { ok: true, outcome: "noop", message: "No changes: the new content matches the live Caddyfile.", etag: current.etag };
    }

    const entry = await startEntry(req.actor, req.summary, current.content, current.etag);
    entry.proposalId = req.proposalId;
    const finish = async (outcome: Outcome, message: string, after?: string): Promise<ApplyResult> => {
      entry.outcome = outcome;
      entry.message = message;
      await saveEntry(entry, after);
      return { ok: outcome === "applied", outcome, message, historyId: entry.id, etag: etagOf(after && outcome === "applied" ? after : current.content), analysis: entry.analysis };
    };

    if (req.actor.kind === "mcp") {
      const importErrors = checkImports(req.content);
      if (importErrors.length) return finish("invalid", importErrors.join("\n"));
    }
    const validation = await validateContent(req.content);
    if (!validation.ok) return finish("invalid", `Validation failed; nothing was written.\n${validation.output}`);

    let untouched: string[] = [];
    let newJson: CaddyJson;
    try {
      const [oldJson, adapted] = await Promise.all([adaptContent(current.content), adaptContent(req.content)]);
      newJson = adapted;
      const control = checkControl(oldJson, newJson);
      if (control.length) return finish("invalid", `Refused; nothing was written.\n${control.join("\n")}`);
      const oldSites = siteMap(oldJson, current.content);
      const newSites = siteMap(newJson, req.content);
      entry.analysis = analyzeChange(current.content, req.content, oldSites, newSites);
      untouched = [...newSites.keys()].filter((h) => oldSites.has(h) && !entry.analysis!.touched.includes(h));
    } catch (err) {
      return finish("invalid", `Could not adapt the config: ${(err as Error).message}`);
    }

    const baseline = await probeHosts(untouched);

    try {
      await writeCaddyfile(req.content);
      await reloadCaddy();
      await assertActive();
      await assertLoaded(newJson);
    } catch (err) {
      return finish("rolled_back", `Reload failed, so the previous Caddyfile was restored. ${await restore(current.content)}\n${(err as Error).message}`, req.content);
    }

    const health = await checkHealth(baseline);
    entry.health = health.rows;
    if (!health.ok) {
      const diffs = health.rows.filter((r) => r.before !== r.after).map((r) => `  ${r.host}: ${r.before.trim()} → ${r.after.trim()}`).join("\n");
      return finish("rolled_back", `Sites the change didn't touch started answering differently, so the previous Caddyfile was restored. ${await restore(current.content)}\n${diffs}`, req.content);
    }
    return finish("applied", `Applied and reloaded.${untouched.length ? ` ${untouched.length} untouched site(s) answer as before.` : ""}`, req.content);
  });
}

async function assertActive() {
  await runCommand(SYSTEMCTL_BIN, ["is-active", "--quiet", "caddy"]).catch(() => {
    throw new Error("caddy is not active after reload");
  });
}

/**
 * Caddy's running config from the admin API. Plain node:http on purpose:
 * fetch() sends Sec-Fetch-Mode, which Caddy's admin API treats as a browser
 * request and refuses with 403.
 */
export function readRunningConfig(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${ADMIN_URL}/config/`, { timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => (body += c.toString()));
      res.on("end", () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error("not JSON"));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

/** Caddy's running config, read back through the admin API, must be exactly what was written. */
async function assertLoaded(expected: CaddyJson) {
  let running: unknown;
  try {
    running = await readRunningConfig();
  } catch (err) {
    throw new Error(`could not read Caddy's running config from ${ADMIN_URL}: ${(err as Error).message}`);
  }
  const diff = firstDifference(running, expected);
  if (diff) throw new Error(`Caddy is not running the new config: the reload had no effect (running config differs at ${diff})`);
}

async function restore(previous: string): Promise<string> {
  try {
    await writeCaddyfile(previous);
    await reloadCaddy();
    await assertActive();
    await assertLoaded(await adaptContent(previous));
    return "Caddy is running the previous config.";
  } catch (err) {
    return `RESTORE FAILED: ${(err as Error).message}. Check Caddy now: journalctl -u caddy -n 50`;
  }
}

async function checkHealth(baseline: Map<string, string>): Promise<{ ok: boolean; rows: { host: string; before: string; after: string }[] }> {
  if (baseline.size === 0) return { ok: true, rows: [] };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await sleep(SETTLE_MS);
  let after = await probeHosts([...baseline.keys()]);
  const mismatched = () => [...baseline].some(([h, b]) => after.get(h) !== b);
  if (mismatched()) {
    // Backends flap; give them one more chance before rolling back
    await sleep(RETRY_MS);
    after = await probeHosts([...baseline.keys()]);
  }
  const rows = [...baseline].map(([host, before]) => ({ host, before, after: after.get(host) ?? "000" }));
  return { ok: !mismatched(), rows };
}

export type { HistoryEntry };
