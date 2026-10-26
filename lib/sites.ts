import { findManagedRegions, markerBegin, markerEnd, parseEntries } from "./caddyfile-parse";

export type Template = "dokploy" | "reverse_proxy";

export interface SiteSpec {
  host: string;
  template: Template;
  /** For template reverse_proxy: host:port, or http(s)://host:port */
  upstream?: string;
  rateLimit?: boolean;
  /** Put the site behind the caddy-security portal, like Portainer */
  auth?: boolean;
}

export class SiteError extends Error {}

const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UPSTREAM_RE = /^(https?:\/\/)?[a-zA-Z0-9.-]+(:\d{1,5})?$/;

export function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!HOST_RE.test(h)) throw new SiteError(`not a valid hostname: ${host}`);
  return h;
}

/** Portal and policy names from the global security block, e.g. myportal / mypolicy. */
export function authNames(content: string): { portal: string; policy: string } | null {
  const global = parseEntries(content).find((e) => e.kind === "global")?.text ?? "";
  const portal = /authentication\s+portal\s+(\S+)/.exec(global)?.[1];
  const policy = /authorization\s+policy\s+(\S+)/.exec(global)?.[1];
  return portal && policy ? { portal, policy } : null;
}

export function renderSite(spec: SiteSpec, content: string): string {
  const host = normalizeHost(spec.host);
  const snippets = new Set(parseEntries(content).filter((e) => e.kind === "snippet").map((e) => e.keys[0]));
  let proxy: string;
  if (spec.template === "dokploy") {
    if (!snippets.has("dokploy_proxy")) throw new SiteError("template dokploy needs a (dokploy_proxy) snippet in the Caddyfile");
    proxy = "import dokploy_proxy";
  } else {
    if (!spec.upstream || !UPSTREAM_RE.test(spec.upstream)) throw new SiteError("template reverse_proxy needs upstream like 192.168.1.50:8080");
    proxy = `reverse_proxy ${spec.upstream}`;
  }
  if (spec.rateLimit && !snippets.has("rate_limit")) throw new SiteError("rate_limit needs a (rate_limit) snippet in the Caddyfile");

  const body: string[] = [];
  if (spec.rateLimit) body.push("\timport rate_limit");
  if (spec.auth) {
    const names = authNames(content);
    if (!names) throw new SiteError("auth needs an authentication portal and authorization policy in the global options");
    body.push(
      "\t@auth {",
      "\t\tpath /caddy-security/*",
      "\t}",
      "\troute @auth {",
      `\t\tauthenticate with ${names.portal}`,
      "\t}",
      "\troute /* {",
      `\t\tauthorize with ${names.policy}`,
      `\t\t${proxy}`,
      "\t}",
    );
  } else {
    body.push(`\t${proxy}`);
  }
  return [markerBegin(host), `${host} {`, ...body, "}", markerEnd(host)].join("\n");
}

/** Hosts defined by hand-written (unmanaged) site blocks. */
function unmanagedHosts(content: string): Set<string> {
  const regions = findManagedRegions(content);
  const inRegion = (line: number) => regions.some((r) => line > r.beginLine && line < r.endLine);
  const hosts = new Set<string>();
  for (const e of parseEntries(content)) {
    if (e.kind !== "site" || inRegion(e.startLine)) continue;
    for (const k of e.keys) hosts.add(k.replace(/^https?:\/\//, "").replace(/:\d+$/, "").toLowerCase());
  }
  return hosts;
}

/** Content with the managed block for spec.host added or replaced. */
export function upsertSite(content: string, spec: SiteSpec): { content: string; replaced: boolean } {
  const host = normalizeHost(spec.host);
  if (unmanagedHosts(content).has(host)) {
    throw new SiteError(`${host} is defined by a hand-written site block; change it with propose_change instead`);
  }
  const block = renderSite({ ...spec, host }, content);
  const lines = content.split("\n");
  const region = findManagedRegions(content).find((r) => r.host.toLowerCase() === host);
  if (region) {
    lines.splice(region.beginLine, region.endLine - region.beginLine + 1, ...block.split("\n"));
    return { content: lines.join("\n"), replaced: true };
  }
  const trimmed = content.replace(/\s*$/, "");
  return { content: `${trimmed}\n\n${block}\n`, replaced: false };
}

/** Content without the managed block for host. */
export function removeSite(content: string, hostIn: string): string {
  const host = normalizeHost(hostIn);
  const region = findManagedRegions(content).find((r) => r.host.toLowerCase() === host);
  if (!region) {
    if (unmanagedHosts(content).has(host)) throw new SiteError(`${host} is hand-written, not managed; remove it with propose_change instead`);
    throw new SiteError(`no managed site ${host}`);
  }
  const lines = content.split("\n");
  // Take one surrounding blank line with it
  let start = region.beginLine;
  if (start > 0 && lines[start - 1].trim() === "") start--;
  lines.splice(start, region.endLine - start + 1);
  return lines.join("\n");
}
