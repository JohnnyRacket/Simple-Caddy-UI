import fs from "fs/promises";
import os from "os";
import path from "path";
import { runCommand } from "./exec";

const CADDYFILE = process.env.CADDYFILE_PATH ?? "/etc/caddy/Caddyfile";

export async function readCaddyfile(): Promise<string> {
  try {
    return await fs.readFile(CADDYFILE, "utf-8");
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

export async function saveCaddyfile(content: string): Promise<void> {
  const tmpPath = path.join(os.tmpdir(), `caddyfile-${Date.now()}`);
  await fs.writeFile(tmpPath, content, "utf-8");
  try {
    await runCommand("sudo", ["/bin/cp", tmpPath, CADDYFILE]);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

export async function reloadCaddy(): Promise<void> {
  await runCommand("sudo", ["/bin/systemctl", "reload", "caddy"]);
}

export async function validateCaddyfile(): Promise<{
  ok: boolean;
  output: string;
}> {
  try {
    const { stdout, stderr } = await runCommand("sudo", [
      "/usr/bin/caddy",
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
    "/usr/bin/caddy",
    ["fmt", "-"],
    { input: content },
  );
  return stdout;
}
