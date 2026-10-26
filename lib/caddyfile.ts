import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import { runCommand } from "./exec";

const rawPath = process.env.CADDYFILE_PATH ?? "/etc/caddy/Caddyfile";

// Validate CADDYFILE_PATH at startup to prevent path traversal
if (!path.isAbsolute(rawPath)) {
  throw new Error(`CADDYFILE_PATH must be an absolute path: ${rawPath}`);
}
if (rawPath.includes("..")) {
  throw new Error(`CADDYFILE_PATH must not contain '..': ${rawPath}`);
}

export const CADDYFILE = rawPath;
/** Directory relative imports resolve against; candidates are checked as if they lived here. */
export const CADDYFILE_DIR = path.dirname(rawPath);

const TEE_BIN = process.env.TEE_BIN ?? "/usr/bin/tee";
const CADDY_BIN = process.env.CADDY_BIN ?? "/usr/bin/caddy";
const CADDY_USER = process.env.CADDY_USER ?? "caddy";
const SYSTEMCTL_BIN = process.env.SYSTEMCTL_BIN ?? "/bin/systemctl";

export function etagOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function readCaddyfile(): Promise<string> {
  try {
    return await fs.readFile(/*turbopackIgnore: true*/ CADDYFILE, "utf-8");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    const detail =
      e.code === "ENOENT"
        ? `file not found`
        : e.code === "EACCES"
          ? `permission denied`
          : e.message;
    throw new Error(
      `Cannot read ${CADDYFILE} — ${detail}. Check the file exists and is readable by the app user.`,
    );
  }
}

export async function readWithEtag(): Promise<{ content: string; etag: string }> {
  const content = await readCaddyfile();
  return { content, etag: etagOf(content) };
}

/** Raw write. Callers outside lib/safe-apply.ts should use safeApply instead. */
export async function writeCaddyfile(content: string): Promise<void> {
  // Content goes over stdin so the sudoers rule can name exact arguments —
  // no source path, no wildcard, nothing for a symlink to redirect.
  await runCommand("sudo", ["-n", TEE_BIN, CADDYFILE], { input: content });
}

export async function reloadCaddy(): Promise<void> {
  await runCommand("sudo", ["-n", SYSTEMCTL_BIN, "reload", "caddy"], { timeoutMs: 60_000 });
}

/** Caddy's JSON log lines are noise here; keep the error, with stdin's "-" shown as "line N". */
function cleanCaddyOutput(output: string): string {
  return output
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith('{"level"'))
    .map((l) => l.replace(/^\[sudo\] /, "").replace(/(^|\s)-:(\d+)/g, "$1line $2"))
    .join("\n")
    .trim();
}

/**
 * Validate Caddyfile text without touching the live file: piped to
 * `caddy validate` as the caddy user (the user Caddy runs as), from the
 * Caddyfile's directory so relative imports resolve as they would live.
 */
export async function validateContent(content: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await runCommand(
      "sudo",
      ["-n", "-u", CADDY_USER, CADDY_BIN, "validate", "--config", "-", "--adapter", "caddyfile"],
      { input: content, cwd: CADDYFILE_DIR, timeoutMs: 60_000 },
    );
    return { ok: true, output: cleanCaddyOutput(stdout + stderr) || "Valid configuration" };
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    return { ok: false, output: cleanCaddyOutput(e.stderr || e.message || String(err)) };
  }
}

/** Adapt Caddyfile text to Caddy's JSON config (no provisioning; runs as the app user). */
export async function adaptContent(content: string): Promise<CaddyJson> {
  try {
    const { stdout } = await runCommand(CADDY_BIN, ["adapt", "--config", "-", "--adapter", "caddyfile"], {
      input: content,
      cwd: CADDYFILE_DIR,
    });
    return JSON.parse(stdout) as CaddyJson;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(cleanCaddyOutput(e.stderr || e.message || String(err)));
  }
}

export async function formatCaddyfile(content: string): Promise<string> {
  const { stdout } = await runCommand(CADDY_BIN, ["fmt", "-"], { input: content });
  return stdout;
}

// The parts of Caddy's JSON config this app reads
export interface CaddyRoute {
  match?: { host?: string[]; [k: string]: unknown }[];
  handle?: CaddyHandler[];
  [k: string]: unknown;
}
export interface CaddyHandler {
  handler: string;
  routes?: CaddyRoute[];
  upstreams?: { dial?: string }[];
  [k: string]: unknown;
}
export interface CaddyJson {
  apps?: { http?: { servers?: Record<string, { listen?: string[]; routes?: CaddyRoute[] }> }; [k: string]: unknown };
  [k: string]: unknown;
}
