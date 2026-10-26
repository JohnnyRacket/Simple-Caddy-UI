import { spawn } from "child_process";

// Child processes get only this environment, never the app's own, which holds
// SECRET_TOKEN from .env.local. Caddy expands {$VAR} placeholders while
// adapting, so an inherited environment could leak into its output.
const MINIMAL_ENV = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" } as unknown as NodeJS.ProcessEnv;

export class CommandError extends Error {
  constructor(
    public cmd: string,
    public exitCode: number | null,
    public stderr: string,
    public cause?: unknown,
  ) {
    const causeStr = String(cause);
    const hint =
      causeStr.includes("ENOENT")
        ? `command not found: ${cmd}`
        : causeStr.includes("EACCES")
          ? `permission denied running: ${cmd}`
          : causeStr.includes("timed out")
            ? `command timed out`
            : stderr.trim() || causeStr;
    super(`[${cmd}] ${hint}`);
    this.name = "CommandError";
  }
}

export function runCommand(
  cmd: string,
  args: string[],
  opts?: { input?: string; timeoutMs?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: opts?.input !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      cwd: opts?.cwd,
      env: MINIMAL_ENV,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, opts?.timeoutMs ?? 15_000);

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    if (opts?.input !== undefined && proc.stdin) {
      proc.stdin.on("error", () => { /* process exited before reading stdin; reported via close */ });
      proc.stdin.write(opts.input);
      proc.stdin.end();
    }

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new CommandError(cmd, null, stderr, err));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CommandError(cmd, null, stderr, new Error("timed out")));
      } else if (code !== 0) {
        reject(new CommandError(cmd, code, stderr, new Error(stderr || `exit code ${code}`)));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export function spawnStream(cmd: string, args: string[]) {
  return spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: MINIMAL_ENV });
}
