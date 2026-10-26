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

const CADDYFILE = rawPath;

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

const TEE_BIN = process.env.TEE_BIN ?? "/usr/bin/tee";
const CADDY_BIN = process.env.CADDY_BIN ?? "/usr/bin/caddy";
const CADDY_USER = process.env.CADDY_USER ?? "caddy";
const SYSTEMCTL_BIN = process.env.SYSTEMCTL_BIN ?? "/bin/systemctl";

export async function saveCaddyfile(content: string): Promise<void> {
  // Content goes over stdin so the sudoers rule can name exact arguments —
  // no source path, no wildcard, nothing for a symlink to redirect.
  await runCommand("sudo", ["-n", TEE_BIN, CADDYFILE], { input: content });
}

export async function reloadCaddy(): Promise<void> {
  await runCommand("sudo", ["-n", SYSTEMCTL_BIN, "reload", "caddy"]);
}

export async function validateCaddyfile(): Promise<{
  ok: boolean;
  output: string;
}> {
  try {
    // Run as the caddy user, not root: a Caddyfile can `import` arbitrary
    // paths, and parse errors echo their contents back to the caller.
    const { stdout, stderr } = await runCommand("sudo", [
      "-n",
      "-u",
      CADDY_USER,
      CADDY_BIN,
      "validate",
      "--config",
      CADDYFILE,
    ]);
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string };
    return { ok: false, output: e.message ?? String(err) };
  }
}

export async function formatCaddyfile(content: string): Promise<string> {
  const { stdout } = await runCommand(
    CADDY_BIN,
    ["fmt", "-"],
    { input: content },
  );
  return stdout;
}
