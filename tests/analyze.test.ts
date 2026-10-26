import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CADDYFILE_PATH = "/etc/caddy/Caddyfile";
});

import { analyzeChange, checkControl, checkImports, siteMap } from "@/lib/analyze";
import type { CaddyJson, CaddyRoute } from "@/lib/caddyfile";

const route = (host: string, handlers: string[], dial?: string) => ({
  match: [{ host: [host] }],
  handle: [{ handler: "subroute", routes: [{ handle: handlers.map((h) => ({ handler: h, ...(h === "reverse_proxy" && dial ? { upstreams: [{ dial }] } : {}) })) }] }],
});
const cfg = (...routes: object[]): CaddyJson => ({ apps: { http: { servers: { srv0: { listen: [":443"], routes: routes as CaddyRoute[] } } } } });

const OLD_TEXT = `{
	security {
	}
}

(dokploy_proxy) {
	reverse_proxy 192.168.1.125:80
}

a.com {
	import rate_limit
	import dokploy_proxy
}
`;

describe("change analysis", () => {
  const oldJson = cfg(
    route("a.com", ["rate_limit", "reverse_proxy"], "192.168.1.125:80"),
    route("secure.com", ["authorization", "reverse_proxy"], "10.0.0.2:9000"),
    route("gone.com", ["static_response"]),
  );

  it("summarizes sites", () => {
    const sites = siteMap(oldJson, OLD_TEXT);
    expect(sites.get("a.com")).toMatchObject({ summary: "reverse_proxy → 192.168.1.125:80", rateLimited: true, auth: false, imports: ["rate_limit", "dokploy_proxy"] });
    expect(sites.get("secure.com")?.auth).toBe(true);
  });

  it("flags removed sites, dropped auth and rate limits, globals and snippets", () => {
    const newJson = cfg(
      route("a.com", ["reverse_proxy"], "192.168.1.125:80"),
      route("secure.com", ["reverse_proxy"], "10.0.0.2:9000"),
      route("new.com", ["reverse_proxy"], "192.168.1.125:80"),
    );
    const newText = OLD_TEXT.replace("security {", "security {\n\t\tx").replace("192.168.1.125:80", "192.168.1.126:80");
    const a = analyzeChange(OLD_TEXT, newText, siteMap(oldJson, OLD_TEXT), siteMap(newJson, newText));
    expect(a.added).toEqual(["new.com"]);
    expect(a.removed).toEqual(["gone.com"]);
    expect(a.changed).toEqual(["a.com", "secure.com"]);
    expect(a.risks.map((r) => r.code).sort()).toEqual(
      ["auth_removed", "global_options", "rate_limit_removed", "site_removed", "snippet_changed"].sort(),
    );
    expect(a.diff).toContain("+\t\tx");
  });

  it("leaves untouched sites out of `touched`", () => {
    const a = analyzeChange(OLD_TEXT, OLD_TEXT + "\nnew.com {\n}\n", siteMap(oldJson, OLD_TEXT), siteMap(cfg(...oldJson.apps!.http!.servers!.srv0.routes!, route("new.com", ["static_response"])) as CaddyJson, OLD_TEXT));
    expect(a.touched).toEqual(["new.com"]);
    expect(a.risks).toEqual([]);
  });

  it("only allows importing snippets and files under the Caddyfile's directory", () => {
    expect(checkImports(OLD_TEXT.replace("import rate_limit", "import /home/caddy/.ssh/id_ed25519"))).toEqual([
      expect.stringMatching(/line 11: import \/home\/caddy\/\.ssh\/id_ed25519/),
    ]);
    expect(checkImports(OLD_TEXT.replace("import rate_limit", "import ../../root/x"))).toHaveLength(1);
    expect(checkImports(OLD_TEXT.replace("import rate_limit", "import sites/*.caddy"))).toEqual([]);
    expect(checkImports(OLD_TEXT.replace("import rate_limit", "import /etc/caddy/extra.caddy"))).toEqual([]);
    // undefined snippet name = relative file under /etc/caddy, allowed (caddy validate reports if missing)
    expect(checkImports(OLD_TEXT)).toEqual([]);
  });

  it("refuses configs that take over Caddy's admin endpoint", () => {
    const base: CaddyJson = { apps: { http: { servers: { srv0: { listen: [":443"] } } } } };
    expect(checkControl(base, base)).toEqual([]);
    expect(checkControl(base, { apps: { http: { servers: { srv0: { listen: [":443"] }, srv1: { listen: [":2019"] } } } } })).toEqual([
      expect.stringMatching(/srv1 listens on :2019, Caddy's admin port/),
    ]);
    expect(checkControl(base, { ...base, admin: { disabled: true } })).toEqual([expect.stringMatching(/admin endpoint/)]);
  });
});
