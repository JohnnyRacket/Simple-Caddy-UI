// Runs against the Docker test environment (real Caddy, sudo, curl) via scripts/integration.sh.
// Env: CADDY_UI_URL (e.g. http://localhost:3100), CONTAINER (docker container name), SECRET_TOKEN.
import { execFileSync } from "child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const URL_ = process.env.CADDY_UI_URL ?? "http://localhost:3100";
const CONTAINER = process.env.CONTAINER ?? "cui-int";
const SECRET = process.env.SECRET_TOKEN ?? "password";

const BASE = `{
	local_certs
}

(common) {
	header X-Test yes
}

a.test {
	import common
	respond "a" 200
}

b.test {
	redir https://a.test/x 307
}
`;

const sh = (cmd: string) => execFileSync("docker", ["exec", CONTAINER, "bash", "-c", cmd], { encoding: "utf-8" }).trim();
/** What Caddy actually answers inside the container */
const served = (host: string) => sh(`curl -sk -m 5 --resolve ${host}:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://${host}/ || true`);
/** New sites answer once their certificate is issued; give that a few seconds */
const servedEventually = async (host: string, want: string) => {
  for (let i = 0; i < 20 && served(host) !== want; i++) await new Promise((r) => setTimeout(r, 500));
  return served(host);
};
const live = () => sh("cat /etc/caddy/Caddyfile");

const ui = async (path: string, init?: RequestInit) => {
  const res = await fetch(URL_ + path, { ...init, headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let token = "";
const clients: Client[] = [];

async function connect(opts: { approve?: boolean | "cancel"; era?: "auto" | "legacy" } = {}) {
  const client = new Client(
    { name: "integration", version: "1.0.0" },
    { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: opts.era ?? "auto" } },
  );
  const asked: string[] = [];
  client.setRequestHandler("elicitation/create", async (req) => {
    asked.push((req.params as { message: string }).message);
    if (opts.approve === "cancel") return { action: "cancel" };
    return { action: "accept", content: { approve: opts.approve ?? true } };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(URL_ + "/api/mcp"), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  clients.push(client);
  return { client, asked };
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> };
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError, data: r.structuredContent ?? {} };
};
const proposalId = (r: { data: Record<string, unknown> }) => r.data.proposal_id as string;

async function setBase() {
  // Through the UI's own safe-apply path, as a human would
  const { body } = await ui("/api/caddyfile");
  if (body.content === BASE) return;
  const res = await ui("/api/caddyfile", { method: "POST", body: JSON.stringify({ content: BASE, etag: body.etag, summary: "test base" }) });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

beforeAll(async () => {
  const res = await ui("/api/tokens", { method: "POST", body: JSON.stringify({ name: `int-${Date.now()}`, scope: "write" }) });
  expect(res.status).toBe(201);
  token = res.body.token;
}, 60_000);
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
});
beforeEach(setBase, 60_000);

describe("real Caddy", () => {
  it("serves the base config", () => {
    expect(served("a.test")).toBe("200");
    expect(served("b.test")).toBe("307");
  });

  it("lists sites from caddy adapt", async () => {
    const { client } = await connect();
    const r = await call(client, "list_sites");
    const sites = (r.data.sites as { host: string; summary: string }[]).map((s) => [s.host, s.summary]);
    expect(sites).toEqual(expect.arrayContaining([["a.test", expect.stringContaining("static_response")], ["b.test", expect.stringContaining("static_response")]]));
  });

  it("proposes, asks, applies, and Caddy serves the new site", async () => {
    const { client, asked } = await connect();
    const p = await call(client, "propose_site", { host: "new.test", template: "reverse_proxy", upstream: "127.0.0.1:9", summary: "add new.test" });
    expect(p.isError, p.text).toBe(false);
    expect(live()).not.toContain("new.test");
    const a = await call(client, "apply", { proposal_id: proposalId(p) });
    expect(a.text).toMatch(/✓ applied/);
    expect(asked[0]).toContain("+ new.test");
    expect(live()).toContain("# caddy-mcp:begin new.test");
    expect(await servedEventually("new.test", "502")).toBe("502"); // live, proxying to a closed port
    expect(served("a.test")).toBe("200");
  }, 60_000);

  it("leaves everything alone when the user rejects", async () => {
    const { client } = await connect({ approve: false });
    const p = await call(client, "propose_site", { host: "nope.test", template: "reverse_proxy", upstream: "127.0.0.1:9" });
    expect((await call(client, "apply", { proposal_id: proposalId(p) })).text).toMatch(/rejected/);
    expect(live()).toBe(BASE.trimEnd());
  }, 60_000);

  it("rejects text Caddy rejects, with Caddy's error", async () => {
    const { client } = await connect();
    const { data } = await call(client, "read");
    const r = await call(client, "propose_change", { content: BASE + "\nc.test {\n\tbogus_directive\n}\n", base_etag: data.etag, summary: "bad" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/unrecognized directive: bogus_directive/);
  });

  it("does not leak files through import errors", async () => {
    const { client } = await connect();
    const r = await call(client, "validate", { content: "import /etc/shadow\n" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/only snippets and files under \/etc\/caddy/);
  });

  it("does not leak the app's environment through {$VAR} placeholders", async () => {
    const { client } = await connect();
    const { data } = await call(client, "read");
    const p = await call(client, "propose_change", { content: BASE.replace('respond "a" 200', 'respond "{$SECRET_TOKEN}" 200'), base_etag: data.etag, summary: "env" });
    expect(p.isError, p.text).toBe(false);
    expect(p.text).not.toContain(SECRET);
  });

  it("refuses a site on Caddy's admin port", async () => {
    const { client } = await connect();
    const { data } = await call(client, "read");
    const p = await call(client, "propose_change", { content: BASE + "\nhttp://:2019 {\n\trespond x\n}\n", base_etag: data.etag, summary: "admin" });
    expect(p.isError).toBe(true);
    expect(p.text).toMatch(/admin port/);
  });

  it("rolls back when the reload fails (port clash only visible at reload)", async () => {
    sh(`(node -e 'require("net").createServer().listen(7777, "0.0.0.0"); setTimeout(() => {}, 60000)' >/dev/null 2>&1 &)`);
    const { client } = await connect();
    const { data } = await call(client, "read");
    const p = await call(client, "propose_change", { content: BASE + "\nhttp://:7777 {\n\trespond x\n}\n", base_etag: data.etag, summary: "clash" });
    expect(p.isError, p.text).toBe(false);
    const a = await call(client, "apply", { proposal_id: proposalId(p) });
    expect(a.text).toMatch(/rolled_back[\s\S]*Reload failed/);
    expect(live()).toBe(BASE.trimEnd());
    expect(served("a.test")).toBe("200");
  }, 60_000);

  it("rolls back when untouched sites stop answering", async () => {
    const { client } = await connect();
    const { data } = await call(client, "read");
    // Changes no site route, but stops Caddy serving HTTPS on 443 — every site breaks
    const p = await call(client, "propose_change", { content: BASE.replace("local_certs", "local_certs\n\thttps_port 8443"), base_etag: data.etag, summary: "move https" });
    expect(p.data.risks).toEqual([expect.objectContaining({ code: "global_options" })]);
    const a = await call(client, "apply", { proposal_id: proposalId(p) });
    expect(a.text).toMatch(/rolled_back[\s\S]*a\.test: 200 → 000/);
    expect(served("a.test")).toBe("200");
  }, 90_000);

  it("refuses to apply over a change made in the UI meanwhile", async () => {
    const { client } = await connect();
    const p = await call(client, "propose_site", { host: "late.test", template: "reverse_proxy", upstream: "127.0.0.1:9" });
    const { body } = await ui("/api/caddyfile");
    await ui("/api/caddyfile", { method: "POST", body: JSON.stringify({ content: body.content + "\nui.test {\n\trespond ui\n}\n", etag: body.etag }) });
    const a = await call(client, "apply", { proposal_id: proposalId(p) });
    expect(a.text).toMatch(/conflict/);
    expect(live()).not.toContain("late.test");
  }, 60_000);

  it("approves through the UI for clients without the form (2025 protocol)", async () => {
    const { client, asked } = await connect({ era: "legacy" });
    const p = await call(client, "propose_site", { host: "legacy.test", template: "reverse_proxy", upstream: "127.0.0.1:9" });
    const first = await call(client, "apply", { proposal_id: proposalId(p) });
    expect(first.text).toContain(`/changes?proposal=${proposalId(p)}`);
    expect(asked).toHaveLength(0);
    const decided = await ui(`/api/proposals/${proposalId(p)}`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(await servedEventually("legacy.test", "502")).toBe("502");
    expect((await call(client, "apply", { proposal_id: proposalId(p) })).text).toMatch(/is applied/);
  }, 60_000);

  it("applies straight away for a client-approval token", async () => {
    const res = await ui("/api/tokens", { method: "POST", body: JSON.stringify({ name: `int-client-${Date.now()}`, scope: "write", approval: "client" }) });
    const client = new Client({ name: "integration-client", version: "1.0.0" }, { capabilities: {}, versionNegotiation: { mode: "auto" } });
    await client.connect(new StreamableHTTPClientTransport(new URL(URL_ + "/api/mcp"), { requestInit: { headers: { Authorization: `Bearer ${res.body.token}` } } }));
    clients.push(client);
    const p = await call(client, "propose_site", { host: "client.test", template: "reverse_proxy", upstream: "127.0.0.1:9" });
    expect(p.data.diff).toContain("+client.test {");
    const a = await call(client, "apply", { proposal_id: proposalId(p) });
    expect(a.data).toMatchObject({ ok: true, outcome: "applied" });
    expect(await servedEventually("client.test", "502")).toBe("502");
    const patched = await ui(`/api/tokens/${res.body.record.id}`, { method: "PATCH", body: JSON.stringify({ approval: "chat" }) });
    expect(patched.body.token.approval).toBe("chat");
  }, 60_000);

  it("rolls back a change through history", async () => {
    const { client } = await connect();
    const p = await call(client, "propose_site", { host: "undo.test", template: "reverse_proxy", upstream: "127.0.0.1:9" });
    await call(client, "apply", { proposal_id: proposalId(p) });
    const h = await call(client, "history", { limit: 1 });
    const id = (h.data.entries as { id: string }[])[0].id;
    const rb = await call(client, "propose_rollback", { history_id: id });
    expect(rb.data.removed).toEqual(["undo.test"]);
    expect((await call(client, "apply", { proposal_id: proposalId(rb) })).text).toMatch(/✓ applied/);
    expect(live()).not.toContain("undo.test");
  }, 90_000);

  it("reads recent logs without request headers", async () => {
    const { client } = await connect();
    const r = await call(client, "logs", { limit: 5 });
    expect(r.isError, r.text).toBe(false);
    expect((r.data.entries as unknown[]).length).toBeGreaterThan(0);
    expect(r.text).not.toMatch(/"headers"/);
  });

  it("checks a domain end to end", async () => {
    const { client } = await connect();
    const r = await call(client, "check_domain", { host: "a.test" });
    expect(r.data).toMatchObject({ host: "a.test", http: "200", dns: { ok: false } }); // .test has no public DNS
  });

  it("serves the UI pages", async () => {
    for (const path of ["/changes", "/tokens", "/editor"]) {
      const res = await fetch(URL_ + path, { headers: { Authorization: `Bearer ${SECRET}` } });
      expect(res.status, path).toBe(200);
    }
    const ch = await ui("/api/changes");
    expect(ch.body.history.length).toBeGreaterThan(3);
    expect(JSON.stringify(ch.body.proposals)).not.toContain('"content":');
  });
});
