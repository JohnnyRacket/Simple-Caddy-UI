// Stand-ins for `caddy adapt` and site probes, for tests that run without Caddy
import { parseEntries } from "@/lib/caddyfile-parse";
import type { CaddyJson } from "@/lib/caddyfile";

export const fakeState = {
  failReloadContaining: "" as string,
  /** Admin API keeps reporting the original config, as if the reload did nothing */
  staleReload: false,
  probe: (() => "200 ") as (host: string) => string,
  reset() {
    this.failReloadContaining = "";
    this.staleReload = false;
    this.probe = () => "200 ";
  },
};

/** Roughly what `caddy adapt` produces: one route per site, snippets inlined. */
export function fakeAdapt(content: string): CaddyJson {
  const entries = parseEntries(content);
  const snippets = new Map(entries.filter((e) => e.kind === "snippet").map((e) => [e.keys[0], e.text]));
  const routes = entries
    .filter((e) => e.kind === "site")
    .map((e) => {
      const body = e.text.replace(/import (\S+)/g, (m, name) => snippets.get(name) ?? m);
      const handlers = [
        ...(body.includes("authorize with") ? [{ handler: "authorization" }] : []),
        ...(body.includes("rate_limit") ? [{ handler: "rate_limit" }] : []),
        body.includes("reverse_proxy")
          ? { handler: "reverse_proxy", upstreams: [{ dial: /reverse_proxy (\S+)/.exec(body)?.[1] ?? "" }] }
          : { handler: "static_response", body },
      ];
      return { match: [{ host: e.keys }], handle: [{ handler: "subroute", routes: [{ handle: handlers }] }] };
    });
  return { apps: { http: { servers: { srv0: { listen: [":443"], routes } } } } };
}
