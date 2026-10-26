import { promises as dns } from "dns";
import tls from "tls";
import { probeHost } from "./probe";

const PROBE_ADDR = process.env.PROBE_ADDR ?? "127.0.0.1";
const PROBE_PORT = Number(process.env.PROBE_PORT ?? 443);

export interface DomainCheck {
  host: string;
  dns: { a: string[]; aaaa: string[]; expected: string[]; ok: boolean; note?: string };
  tls: { ok: boolean; issuer?: string; validTo?: string; error?: string };
  http: string;
  ready: boolean;
}

/**
 * The box's public address(es): CADDY_PUBLIC_IPS if set, else the A record most
 * of the configured sites resolve to.
 */
export async function expectedIps(knownHosts: string[]): Promise<string[]> {
  const fromEnv = (process.env.CADDY_PUBLIC_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length) return fromEnv;
  const counts = new Map<string, number>();
  await Promise.all(
    knownHosts.slice(0, 20).map(async (h) => {
      for (const ip of await dns.resolve4(h).catch(() => [] as string[])) counts.set(ip, (counts.get(ip) ?? 0) + 1);
    }),
  );
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? [best[0]] : [];
}

function certInfo(host: string): Promise<DomainCheck["tls"]> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: PROBE_ADDR, port: PROBE_PORT, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      const issuer = [cert.issuer?.O, cert.issuer?.CN].filter(Boolean).join(" / ");
      resolve(
        socket.authorized
          ? { ok: true, issuer, validTo: cert.valid_to }
          : { ok: false, issuer, validTo: cert.valid_to, error: String(socket.authorizationError) },
      );
      socket.end();
    });
    socket.on("timeout", () => { resolve({ ok: false, error: "timed out" }); socket.destroy(); });
    socket.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

export async function checkDomain(host: string, knownHosts: string[]): Promise<DomainCheck> {
  const [a, aaaa, expected] = await Promise.all([
    dns.resolve4(host).catch(() => [] as string[]),
    dns.resolve6(host).catch(() => [] as string[]),
    expectedIps(knownHosts.filter((h) => h !== host)),
  ]);
  const dnsOk = a.length > 0 && (expected.length === 0 || a.every((ip) => expected.includes(ip)));
  const note =
    a.length === 0 ? "no A record: add one in Cloudflare (DNS only) pointing at this box"
    : !dnsOk ? `resolves to ${a.join(", ")}, not this box (${expected.join(", ")})`
    : undefined;
  const [tlsInfo, http] = await Promise.all([certInfo(host), probeHost(host)]);
  return {
    host,
    dns: { a, aaaa, expected, ok: dnsOk, note },
    tls: tlsInfo,
    http,
    ready: dnsOk && tlsInfo.ok && !http.startsWith("000") && !http.startsWith("5"),
  };
}
