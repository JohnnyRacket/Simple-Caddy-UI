import { describe, expect, it } from "vitest";
import { parseEntries } from "@/lib/caddyfile-parse";
import { removeSite, upsertSite } from "@/lib/sites";

const BASE = `{
	security {
		authentication portal myportal {
		}
		authorization policy mypolicy {
		}
	}
}

(rate_limit) {
	rate_limit {
	}
}

(dokploy_proxy) {
	reverse_proxy 192.168.1.125:80
}

hand.example.com {
	respond "hand-written"
}
`;

describe("managed sites", () => {
  it("adds a dokploy site between markers", () => {
    const { content, replaced } = upsertSite(BASE, { host: "App.Example.com", template: "dokploy", rateLimit: true });
    expect(replaced).toBe(false);
    expect(content.endsWith(
      "# caddy-mcp:begin app.example.com\napp.example.com {\n\timport rate_limit\n\timport dokploy_proxy\n}\n# caddy-mcp:end app.example.com\n",
    )).toBe(true);
    expect(parseEntries(content).at(-1)?.keys).toEqual(["app.example.com"]);
  });

  it("replaces an existing managed site in place", () => {
    const once = upsertSite(BASE, { host: "app.example.com", template: "dokploy" }).content;
    const twice = upsertSite(once, { host: "app.example.com", template: "reverse_proxy", upstream: "10.0.0.5:8080" });
    expect(twice.replaced).toBe(true);
    expect(twice.content.match(/caddy-mcp:begin app\.example\.com/g)).toHaveLength(1);
    expect(twice.content).toContain("reverse_proxy 10.0.0.5:8080");
    expect(twice.content).not.toContain("import dokploy_proxy\n}\n# caddy-mcp:end");
  });

  it("uses the portal and policy names from the global block for auth", () => {
    const { content } = upsertSite(BASE, { host: "secure.example.com", template: "dokploy", auth: true });
    expect(content).toContain("authenticate with myportal");
    expect(content).toContain("authorize with mypolicy");
  });

  it("refuses to touch hand-written sites", () => {
    expect(() => upsertSite(BASE, { host: "hand.example.com", template: "dokploy" })).toThrow(/hand-written/);
    expect(() => removeSite(BASE, "hand.example.com")).toThrow(/hand-written/);
  });

  it("rejects bad hosts and upstreams", () => {
    expect(() => upsertSite(BASE, { host: "bad host", template: "dokploy" })).toThrow(/valid hostname/);
    expect(() => upsertSite(BASE, { host: "x.example.com", template: "reverse_proxy", upstream: "1.2.3.4:80 {\n}" })).toThrow(/upstream/);
    expect(() => upsertSite(BASE.replace(/\(dokploy_proxy\)[\s\S]*?\n}\n/, ""), { host: "x.example.com", template: "dokploy" })).toThrow(/dokploy_proxy/);
  });

  it("removes a managed site and restores the original text", () => {
    const added = upsertSite(BASE, { host: "app.example.com", template: "dokploy" }).content;
    expect(removeSite(added, "app.example.com").trimEnd()).toBe(BASE.trimEnd());
    expect(() => removeSite(BASE, "nope.example.com")).toThrow(/no managed site/);
  });
});
