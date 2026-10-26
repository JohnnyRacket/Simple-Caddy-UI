import path from "path";
import { createTwoFilesPatch, diffLines } from "diff";
import { CADDYFILE_DIR, type CaddyHandler, type CaddyJson, type CaddyRoute } from "./caddyfile";
import { findImports, findManagedRegions, parseEntries, type Entry } from "./caddyfile-parse";

export interface SiteInfo {
  host: string;
  /** e.g. "reverse_proxy → 192.168.1.125:80" */
  summary: string;
  handlers: string[];
  upstreams: string[];
  auth: boolean;
  rateLimited: boolean;
  managed: boolean;
  imports: string[];
  /** Stable JSON of this host's routes, for change detection */
  fingerprint: string;
}

export interface Risk {
  code:
    | "site_removed"
    | "global_options"
    | "snippet_changed"
    | "auth_removed"
    | "auth_site"
    | "sensitive_host"
    | "rate_limit_removed"
    | "large_diff";
  message: string;
}

export interface ChangeAnalysis {
  diff: string;
  changedLines: number;
  added: string[];
  removed: string[];
  changed: string[];
  /** Hosts whose behavior may differ after the change (added + removed + changed) */
  touched: string[];
  risks: Risk[];
}

const AUTH_HANDLERS = new Set(["authentication", "authorization", "authenticator"]);
const LARGE_DIFF = 40;

const SENSITIVE = (process.env.CADDY_SENSITIVE_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function walkHandlers(handlers: CaddyHandler[] | undefined, out: CaddyHandler[]) {
  for (const h of handlers ?? []) {
    out.push(h);
    for (const r of h.routes ?? []) walkHandlers(r.handle, out);
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** Per-host view of an adapted config. */
export function siteMap(json: CaddyJson, content: string): Map<string, SiteInfo> {
  const byHost = new Map<string, CaddyRoute[]>();
  for (const server of Object.values(json.apps?.http?.servers ?? {})) {
    for (const route of server.routes ?? []) {
      const hosts = (route.match ?? []).flatMap((m) => m.host ?? []);
      for (const h of hosts) byHost.set(h.toLowerCase(), [...(byHost.get(h.toLowerCase()) ?? []), route]);
    }
  }

  let entries: Entry[] = [];
  let managed = new Set<string>();
  try {
    entries = parseEntries(content);
    managed = new Set(findManagedRegions(content).map((r) => r.host.toLowerCase()));
  } catch {
    /* Caddy accepted it; our parser is only used for extras */
  }

  const sites = new Map<string, SiteInfo>();
  for (const [host, routes] of byHost) {
    const handlers: CaddyHandler[] = [];
    for (const r of routes) walkHandlers(r.handle, handlers);
    const names = handlers.map((h) => h.handler).filter((n) => n !== "subroute");
    const upstreams = handlers.flatMap((h) => (h.upstreams ?? []).map((u) => u.dial ?? "")).filter(Boolean);
    const entry = entries.find((e) => e.kind === "site" && e.keys.some((k) => stripScheme(k) === host));
    const imports = entry ? findImports(entry.text).map((i) => i.arg) : [];
    const main = names.find((n) => !AUTH_HANDLERS.has(n) && n !== "rate_limit" && n !== "headers" && n !== "vars") ?? names[0] ?? "none";
    sites.set(host, {
      host,
      summary: upstreams.length ? `${main} → ${[...new Set(upstreams)].join(", ")}` : main,
      handlers: [...new Set(names)],
      upstreams: [...new Set(upstreams)],
      auth: names.some((n) => AUTH_HANDLERS.has(n)),
      rateLimited: names.includes("rate_limit"),
      managed: managed.has(host),
      imports,
      fingerprint: JSON.stringify(sortKeys(routes)),
    });
  }
  return sites;
}

const stripScheme = (addr: string) => addr.replace(/^https?:\/\//, "").replace(/:\d+$/, "").replace(/\/.*$/, "").toLowerCase();

export const unifiedDiff = (oldText: string, newText: string) =>
  createTwoFilesPatch("Caddyfile", "Caddyfile", oldText, newText, "current", "proposed", { context: 3 });

export function analyzeChange(
  oldText: string,
  newText: string,
  oldSites: Map<string, SiteInfo>,
  newSites: Map<string, SiteInfo>,
): ChangeAnalysis {
  const diff = unifiedDiff(oldText, newText);
  const changedLines = diffLines(oldText, newText)
    .filter((p) => p.added || p.removed)
    .reduce((n, p) => n + (p.count ?? 0), 0);

  const added = [...newSites.keys()].filter((h) => !oldSites.has(h)).sort();
  const removed = [...oldSites.keys()].filter((h) => !newSites.has(h)).sort();
  const changed = [...newSites.keys()]
    .filter((h) => oldSites.has(h) && oldSites.get(h)!.fingerprint !== newSites.get(h)!.fingerprint)
    .sort();
  const touched = [...added, ...removed, ...changed];

  const risks: Risk[] = [];
  if (removed.length) risks.push({ code: "site_removed", message: `Removes site${removed.length > 1 ? "s" : ""}: ${removed.join(", ")}` });

  const oldEntries = safeEntries(oldText);
  const newEntries = safeEntries(newText);
  const globalOf = (es: Entry[]) => es.find((e) => e.kind === "global")?.text ?? "";
  if (globalOf(oldEntries) !== globalOf(newEntries)) {
    risks.push({ code: "global_options", message: "Changes the global options block (affects every site; includes the security/auth config)" });
  }
  const snippets = (es: Entry[]) => new Map(es.filter((e) => e.kind === "snippet").map((e) => [e.keys[0], e.text]));
  const os = snippets(oldEntries);
  const ns = snippets(newEntries);
  const changedSnippets = [...new Set([...os.keys(), ...ns.keys()])].filter((k) => os.get(k) !== ns.get(k));
  if (changedSnippets.length) {
    risks.push({ code: "snippet_changed", message: `Changes snippet${changedSnippets.length > 1 ? "s" : ""} ${changedSnippets.map((s) => `(${s})`).join(", ")}, which affect every site importing them` });
  }

  for (const h of touched) {
    const before = oldSites.get(h);
    const after = newSites.get(h);
    if (before?.auth && after && !after.auth) risks.push({ code: "auth_removed", message: `Removes authentication from ${h}` });
    else if (before?.auth || after?.auth) risks.push({ code: "auth_site", message: `Touches ${h}, which is behind the auth portal` });
    if (SENSITIVE.includes(h)) risks.push({ code: "sensitive_host", message: `Touches ${h}, marked sensitive` });
    if (before?.rateLimited && after && !after.rateLimited) risks.push({ code: "rate_limit_removed", message: `Removes rate limiting from ${h}` });
  }
  if (changedLines > LARGE_DIFF) risks.push({ code: "large_diff", message: `Large change: ${changedLines} lines` });

  return { diff, changedLines, added, removed, changed, touched, risks };
}

function safeEntries(text: string): Entry[] {
  try {
    return parseEntries(text);
  } catch {
    return [];
  }
}

const DEFAULT_ADMIN = "localhost:2019";
const portOf = (addr: string) => /:(\d+)(?:-\d+)?$/.exec(addr)?.[1];

/**
 * Configs that would break this app's own control of Caddy. Reloads go through
 * the admin API, so a site bound to the admin port silently swallows every
 * later reload, and a changed or disabled admin endpoint stops reloads outright.
 */
export function checkControl(oldJson: CaddyJson, newJson: CaddyJson): string[] {
  const errors: string[] = [];
  if (JSON.stringify(sortKeys(oldJson.admin ?? null)) !== JSON.stringify(sortKeys(newJson.admin ?? null))) {
    errors.push("changes the admin endpoint (global `admin` option), which this app reloads Caddy through; edit it on the box by hand");
  }
  const admin = (newJson.admin as { listen?: string; disabled?: boolean } | undefined)?.listen ?? DEFAULT_ADMIN;
  const adminPort = portOf(admin);
  for (const [name, server] of Object.entries(newJson.apps?.http?.servers ?? {})) {
    for (const listen of server.listen ?? []) {
      if (adminPort && portOf(listen) === adminPort) {
        errors.push(`server ${name} listens on ${listen}, Caddy's admin port: reloads would silently stop taking effect`);
      }
    }
  }
  return errors;
}

/** Same config, ignoring key order. */
export const sameConfig = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));

/** Path of the first difference between two configs, e.g. "apps.http.servers.srv0.listen", for error messages. */
export function firstDifference(a: unknown, b: unknown, at = ""): string | null {
  if (sameConfig(a, b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], at ? `${at}.${k}` : k);
      if (d) return d;
    }
  }
  return at || "(root)";
}

/**
 * Agent-submitted text may only import snippets or files inside the Caddyfile's
 * directory. Validation runs as the caddy user and echoes parse errors, so an
 * `import /home/caddy/.ssh/id_ed25519` would leak the file piece by piece.
 */
export function checkImports(text: string): string[] {
  const snippetNames = new Set(safeEntries(text).filter((e) => e.kind === "snippet").map((e) => e.keys[0]));
  const errors: string[] = [];
  for (const { arg, line } of findImports(text)) {
    if (snippetNames.has(arg)) continue;
    const resolved = path.resolve(CADDYFILE_DIR, arg);
    if (resolved !== CADDYFILE_DIR && !resolved.startsWith(CADDYFILE_DIR + path.sep)) {
      errors.push(`line ${line + 1}: import ${arg} — only snippets and files under ${CADDYFILE_DIR} may be imported`);
    }
  }
  return errors;
}
