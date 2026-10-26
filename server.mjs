// Custom server whose only job is to pin the client IP to the real TCP peer.
// `next start` keeps any X-Forwarded-For a client sends, which would let anyone
// on the internet claim a LAN address and walk past the LOCAL_ONLY check.
import { createServer } from "node:http";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);
// Unset = every interface, IPv4 and IPv6
const host = process.env.HOST || undefined;

const FORWARDING_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
];

function normalizeIp(ip) {
  return ip.trim().replace(/^::ffff:/, "");
}

// Peers allowed to report the client IP via X-Forwarded-For, e.g. a Caddy
// instance proxying to this app. Forwarding headers from anyone else are dropped.
const TRUSTED_PROXIES = new Set(
  (process.env.TRUSTED_PROXIES ?? "").split(",").map(normalizeIp).filter(Boolean),
);

function resolveClientIp(req) {
  const peer = normalizeIp(req.socket.remoteAddress ?? "");
  if (!TRUSTED_PROXIES.has(peer)) {
    for (const h of FORWARDING_HEADERS) delete req.headers[h];
    return peer;
  }
  // A trusted proxy appends the address it saw, so the last entry is the one to believe
  const hops = [req.headers["x-forwarded-for"] ?? []]
    .flat()
    .join(",")
    .split(",")
    .map(normalizeIp)
    .filter(Boolean);
  delete req.headers["x-real-ip"];
  return hops.at(-1) ?? peer;
}

const app = next({ dev, hostname: host, port });
const handle = app.getRequestHandler();
await app.prepare();

createServer((req, res) => {
  req.headers["x-forwarded-for"] = resolveClientIp(req);
  handle(req, res);
}).listen(port, host, () => {
  console.log(`> Caddy UI ready on http://${host ?? "localhost"}:${port} (${dev ? "dev" : "production"})`);
});
