import { spawn } from "child_process";

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
            ? `command timed out after 15s`
            : stderr.trim() || causeStr;
    super(`[${cmd}] ${hint}`);
    this.name = "CommandError";
  }
}

export function runCommand(
  cmd: string,
  args: string[],
  opts?: { input?: string; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: opts?.input !== undefined ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
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
  return spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
}
