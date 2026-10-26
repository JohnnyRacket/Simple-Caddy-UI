import { runCommand } from "./exec";

const JOURNALCTL_BIN = process.env.JOURNALCTL_BIN ?? "/usr/bin/journalctl";

export interface LogEntry {
  ts: string;
  level: string;
  logger?: string;
  msg: string;
  host?: string;
  /** Remaining structured fields Caddy logged */
  fields?: Record<string, unknown>;
}

/** Recent Caddy log entries, newest last. */
export async function recentLogs(opts: { host?: string; level?: string; limit?: number }): Promise<LogEntry[]> {
  // Fixed arguments, matching the sudoers rule exactly
  const { stdout } = await runCommand("sudo", ["-n", JOURNALCTL_BIN, "-u", "caddy", "-n", "500", "--no-pager", "-o", "json"], { timeoutMs: 20_000 });
  const entries: LogEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let message: string;
    let journalTs: string | undefined;
    try {
      const j = JSON.parse(line) as { MESSAGE?: string | number[]; __REALTIME_TIMESTAMP?: string };
      message = Array.isArray(j.MESSAGE) ? Buffer.from(j.MESSAGE).toString() : (j.MESSAGE ?? "");
      if (j.__REALTIME_TIMESTAMP) journalTs = new Date(Number(j.__REALTIME_TIMESTAMP) / 1000).toISOString();
    } catch {
      message = line; // not journal JSON (e.g. a stand-in journalctl): treat the line as the message
    }
    entries.push(parseCaddyLine(message, journalTs));
  }
  const level = opts.level?.toLowerCase();
  const host = opts.host?.toLowerCase();
  return entries
    .filter((e) => !level || e.level === level)
    .filter((e) => !host || e.host === host || JSON.stringify(e.fields ?? {}).toLowerCase().includes(host))
    .slice(-(opts.limit ?? 50));
}

function parseCaddyLine(message: string, journalTs?: string): LogEntry {
  try {
    const { level, ts, logger, msg, request, ...rest } = JSON.parse(message) as Record<string, unknown> & {
      level?: string; ts?: number; logger?: string; msg?: string; request?: { host?: string } & Record<string, unknown>;
    };
    // Never hand request headers (cookies, tokens) to the caller
    const safeRequest = request ? { host: request.host, method: request.method, uri: request.uri, remote_ip: request.remote_ip } : undefined;
    return {
      ts: ts ? new Date(ts * 1000).toISOString() : (journalTs ?? ""),
      level: level ?? "info",
      logger,
      msg: msg ?? "",
      host: request?.host?.toLowerCase(),
      fields: { ...rest, ...(safeRequest ? { request: safeRequest } : {}) },
    };
  } catch {
    return { ts: journalTs ?? "", level: "info", msg: message };
  }
}
