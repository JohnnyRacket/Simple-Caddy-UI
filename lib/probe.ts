import { runCommand } from "./exec";

const CURL_BIN = process.env.CURL_BIN ?? "/usr/bin/curl";
// Where Caddy answers on this box; requests carry the real hostname via --resolve
const PROBE_ADDR = process.env.PROBE_ADDR ?? "127.0.0.1";
const PROBE_PORT = process.env.PROBE_PORT ?? "443";
const CONCURRENCY = 6;

/** "status redirect" for one host, e.g. "302 https://…/login" or "000" when unreachable. */
export async function probeHost(host: string): Promise<string> {
  try {
    const { stdout } = await runCommand(
      CURL_BIN,
      ["-s", "-o", "/dev/null", "-m", "10", "-k", "--resolve", `${host}:${PROBE_PORT}:${PROBE_ADDR}`, "-w", "%{http_code} %{redirect_url}", `https://${host}:${PROBE_PORT}/`],
      { timeoutMs: 15_000 },
    );
    // Strip per-request randomness (OAuth state, nonces) so repeat probes compare equal
    return stdout.replace(/(state|nonce|code_challenge|sid)=[^&\s]*/g, "$1=X").replace(`:${PROBE_PORT}/`, "/").trim();
  } catch {
    return "000";
  }
}

export async function probeHosts(hosts: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const queue = hosts.filter((h) => !h.includes("*"));
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let h = queue.shift(); h; h = queue.shift()) results.set(h, await probeHost(h));
    }),
  );
  return results;
}
