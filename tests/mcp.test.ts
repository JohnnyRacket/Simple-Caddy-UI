// End-to-end through the real /api/mcp route and an MCP client, in process.
// Only the Caddy/sudo commands are faked (tests/fake-caddy.ts); Docker runs them for real.
import fs from "fs";
import http from "http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const env = await vi.hoisted(async () => {
  const [{ mkdtempSync }, { tmpdir }, { join }] = await Promise.all([import("fs"), import("os"), import("path")]);
  const dir = mkdtempSync(join(tmpdir(), "caddy-ui-test-"));
  process.env.CADDY_UI_DATA_DIR = dir + "/data";
  process.env.CADDYFILE_PATH = dir + "/Caddyfile";
  process.env.SYSTEMCTL_BIN = "/usr/bin/true";
  process.env.APPLY_SETTLE_MS = "0";
  process.env.APPLY_RETRY_MS = "0";
  process.env.CADDY_ADMIN_URL = "http://127.0.0.1:23019";
  return { dir, caddyfile: dir + "/Caddyfile" };
});

vi.mock("@/lib/caddyfile", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/caddyfile")>();
  const { fakeAdapt, fakeState } = await import("./fake-caddy");
  const fsp = await import("fs/promises");
  return {
    ...orig,
    validateContent: async (c: string) => (c.includes("bogus") ? { ok: false, output: "line 2: unrecognized directive: bogus" } : { ok: true, output: "Valid configuration" }),
    adaptContent: async (c: string) => fakeAdapt(c),
    writeCaddyfile: async (c: string) => fsp.writeFile(orig.CADDYFILE, c),
    reloadCaddy: async () => {
      if (fakeState.failReloadContaining && (await fsp.readFile(orig.CADDYFILE, "utf-8")).includes(fakeState.failReloadContaining)) throw new Error("reload: address already in use");
    },
    formatCaddyfile: async (c: string) => c.replace(/ {4}/g, "\t"),
  };
});
vi.mock("@/lib/probe", async () => {
  const { fakeState } = await import("./fake-caddy");
  const probe = async (h: string) => fakeState.probe(h);
  return { probeHost: probe, probeHosts: async (hs: string[]) => new Map(await Promise.all(hs.map(async (h) => [h, await probe(h)] as [string, string]))) };
});

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { GET, POST, DELETE } from "@/app/api/mcp/route";
import { listEntries } from "@/lib/history";
import { decide, getProposal } from "@/lib/proposals";
import { createToken, setApproval } from "@/lib/tokens";
import { fakeState } from "./fake-caddy";

const ORIGINAL = `{
	security {
		authentication portal myportal {
		}
		authorization policy mypolicy {
		}
	}
}

(dokploy_proxy) {
	reverse_proxy 192.168.1.125:80
}

keep.example.com {
	import dokploy_proxy
}
`;

const route = (req: Request) => (req.method === "GET" ? GET(req) : req.method === "DELETE" ? DELETE(req) : POST(req));

type Answer = { action: "accept"; content: { approve: boolean } } | { action: "decline" } | { action: "cancel" };

async function connect(token: string, opts: { era: "modern" | "legacy"; answer?: () => Answer; elicitation?: boolean }) {
  const client = new Client(
    { name: "test", version: "1.0.0" },
    {
      capabilities: opts.elicitation === false ? {} : { elicitation: { form: {} } },
      versionNegotiation: { mode: opts.era === "modern" ? "auto" : "legacy" },
    },
  );
  const asked: string[] = [];
  if (opts.elicitation !== false) {
    client.setRequestHandler("elicitation/create", async (request) => {
      asked.push((request.params as { message: string }).message);
      return (opts.answer ?? (() => ({ action: "accept", content: { approve: true } })))();
    });
  }
  const transport = new StreamableHTTPClientTransport(new URL("http://caddy.test:3000/api/mcp"), {
    fetch: (url, init) => route(new Request(url, init)),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return { client, asked };
}

const textOf = (r: unknown) => ((r as { content: { text: string }[] }).content ?? []).map((c) => c.text).join("\n");
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { r, text: textOf(r), isError: !!(r as { isError?: boolean }).isError };
};

let writeToken = "";
let readToken = "";
let clientToken = "";
let clientTokenId = "";

// Stand-in for Caddy's admin API: reports the running config as whatever the file adapts to
let admin: http.Server;
beforeAll(async () => {
  const { fakeAdapt } = await import("./fake-caddy");
  admin = http.createServer((_req, res) => {
    res.end(JSON.stringify(fakeAdapt(fakeState.staleReload ? ORIGINAL : fs.readFileSync(env.caddyfile, "utf-8"))));
  });
  await new Promise<void>((r) => admin.listen(23019, "127.0.0.1", r));
  writeToken = (await createToken("test-writer", "write")).token;
  readToken = (await createToken("test-reader", "read")).token;
  const client = await createToken("test-client-approval", "write", "client");
  clientToken = client.token;
  clientTokenId = client.record.id;
});
afterAll(() => {
  admin.close();
  fs.rmSync(env.dir, { recursive: true, force: true });
});
beforeEach(() => {
  fs.writeFileSync(env.caddyfile, ORIGINAL);
  fakeState.reset();
});

describe("auth", () => {
  it("rejects missing and unknown tokens", async () => {
    const res = await POST(new Request("http://caddy.test:3000/api/mcp", { method: "POST", body: "{}", headers: { Authorization: "Bearer cmcp_nope" } }));
    expect(res.status).toBe(401);
  });

  it("gives read tokens only read tools", async () => {
    const { client } = await connect(readToken, { era: "modern" });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["check_domain", "format", "history", "list_sites", "logs", "read", "validate"]);
    await client.close();
  });
});

// 2025-era clients over stateless HTTP can't receive the approval form (the SDK
// needs a session for server-to-client requests); they approve in the UI instead.
describe("legacy protocol", () => {
  it("asks for approval in the UI, then applies", async () => {
    const legacy = await connect(writeToken, { era: "legacy" });
    const p = await call(legacy.client, "propose_site", { host: "new.example.com", template: "dokploy" });
    const id = (p.r.structuredContent as { proposal_id: string }).proposal_id;
    const first = await call(legacy.client, "apply", { proposal_id: id });
    expect(first.text).toContain(`/changes?proposal=${id}`);
    expect(legacy.asked).toHaveLength(0);
    await decide(id, "approved", "ui");
    expect((await call(legacy.client, "apply", { proposal_id: id })).text).toMatch(/applied/);
    await legacy.client.close();
  });
});

for (const era of ["modern"] as const) {
  describe(`propose → approve → apply (${era} protocol)`, () => {
    let session: Awaited<ReturnType<typeof connect>>;
    let answer: () => Answer;
    beforeEach(async () => {
      answer = () => ({ action: "accept", content: { approve: true } });
      session = await connect(writeToken, { era, answer: () => answer() });
    });
    afterEach(async () => session.client.close());

    it("applies an approved site and records it", async () => {
      const p = await call(session.client, "propose_site", { host: "new.example.com", template: "dokploy" });
      expect(p.isError).toBe(false);
      expect(fs.readFileSync(env.caddyfile, "utf-8")).toBe(ORIGINAL); // proposing writes nothing
      const id = (p.r.structuredContent as { proposal_id: string }).proposal_id;
      expect(p.text).toContain("+new.example.com {");

      const a = await call(session.client, "apply", { proposal_id: id });
      expect(a.text).toMatch(/applied/);
      expect(session.asked).toHaveLength(1);
      expect(session.asked[0]).toContain("+ new.example.com");
      expect(fs.readFileSync(env.caddyfile, "utf-8")).toContain("# caddy-mcp:begin new.example.com");

      const [latest] = await listEntries(1);
      expect(latest).toMatchObject({ outcome: "applied", actor: { kind: "mcp", tokenName: "test-writer" }, proposalId: id });
      expect((await getProposal(id))?.status).toBe("applied");
      // Applying again does nothing
      expect((await call(session.client, "apply", { proposal_id: id })).text).toMatch(/is applied/);
    });

    it("writes nothing when the user rejects", async () => {
      answer = () => ({ action: "accept", content: { approve: false } });
      const p = await call(session.client, "propose_site", { host: "new.example.com", template: "dokploy" });
      const id = (p.r.structuredContent as { proposal_id: string }).proposal_id;
      const a = await call(session.client, "apply", { proposal_id: id });
      expect(a.text).toMatch(/rejected/);
      expect(fs.readFileSync(env.caddyfile, "utf-8")).toBe(ORIGINAL);
      expect((await getProposal(id))?.status).toBe("rejected");
    });

    it("keeps the proposal pending when the form is dismissed", async () => {
      answer = () => ({ action: "cancel" });
      const p = await call(session.client, "propose_site", { host: "new.example.com", template: "dokploy" });
      const id = (p.r.structuredContent as { proposal_id: string }).proposal_id;
      expect((await call(session.client, "apply", { proposal_id: id })).text).toMatch(/still pending/);
      expect((await getProposal(id))?.status).toBe("pending");
    });
  });
}

describe("client approval (the client's permission prompt is the approval)", () => {
  it("applies without asking again, and records how it was approved", async () => {
    const { client, asked } = await connect(clientToken, { era: "modern" });
    const p = await call(client, "propose_site", { host: "new.example.com", template: "dokploy" });
    const sc = p.r.structuredContent as { proposal_id: string; diff: string; review_url: string };
    // Code Mode only passes structured results on, so the diff must be there
    expect(sc.diff).toContain("+new.example.com {");
    expect(sc.review_url).toBe(`http://caddy.test:3000/changes?proposal=${sc.proposal_id}`);
    const a = await call(client, "apply", { proposal_id: sc.proposal_id });
    expect(a.r.structuredContent).toMatchObject({ ok: true, outcome: "applied" });
    expect(asked).toHaveLength(0);
    expect((await getProposal(sc.proposal_id))?.decidedVia).toBe("client");
    expect(fs.readFileSync(env.caddyfile, "utf-8")).toContain("new.example.com");
    await client.close();
  });

  it("goes back to the form when the token is switched to chat approval", async () => {
    await setApproval(clientTokenId, "chat");
    const { client, asked } = await connect(clientToken, { era: "modern", answer: () => ({ action: "accept", content: { approve: false } }) });
    const p = await call(client, "propose_site", { host: "new.example.com", template: "dokploy" });
    const a = await call(client, "apply", { proposal_id: (p.r.structuredContent as { proposal_id: string }).proposal_id });
    expect(asked).toHaveLength(1);
    expect(a.text).toMatch(/rejected/);
    await setApproval(clientTokenId, "client");
    await client.close();
  });
});

describe("safety", () => {
  let session: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => (session = await connect(writeToken, { era: "modern" })));
  afterEach(async () => session.client.close());

  it("refuses to apply over a file that changed since the proposal", async () => {
    const p = await call(session.client, "propose_site", { host: "new.example.com", template: "dokploy" });
    fs.appendFileSync(env.caddyfile, "\nother.example.com {\n}\n"); // someone saved in the UI meanwhile
    const a = await call(session.client, "apply", { proposal_id: (p.r.structuredContent as { proposal_id: string }).proposal_id });
    expect(a.isError).toBe(true);
    expect(a.text).toMatch(/conflict/);
    expect(fs.readFileSync(env.caddyfile, "utf-8")).not.toContain("new.example.com");
  });

  it("rolls back when the reload fails", async () => {
    fakeState.failReloadContaining = "broken.example.com";
    const p = await call(session.client, "propose_site", { host: "broken.example.com", template: "dokploy" });
    const a = await call(session.client, "apply", { proposal_id: (p.r.structuredContent as { proposal_id: string }).proposal_id });
    expect(a.text).toMatch(/rolled_back[\s\S]*Reload failed/);
    expect(fs.readFileSync(env.caddyfile, "utf-8")).toBe(ORIGINAL);
  });

  it("rolls back when the reload silently had no effect", async () => {
    fakeState.staleReload = true;
    const p = await call(session.client, "propose_site", { host: "new.example.com", template: "dokploy" });
    const a = await call(session.client, "apply", { proposal_id: (p.r.structuredContent as { proposal_id: string }).proposal_id });
    expect(a.text).toMatch(/rolled_back[\s\S]*not running the new config/);
    expect(fs.readFileSync(env.caddyfile, "utf-8")).toBe(ORIGINAL);
  });

  it("rolls back when an untouched site starts answering differently", async () => {
    fakeState.probe = (h) => (h === "keep.example.com" && fs.readFileSync(env.caddyfile, "utf-8").includes("new.example.com") ? "502 " : "200 ");
    const p = await call(session.client, "propose_site", { host: "new.example.com", template: "dokploy" });
    const a = await call(session.client, "apply", { proposal_id: (p.r.structuredContent as { proposal_id: string }).proposal_id });
    expect(a.text).toMatch(/keep\.example\.com: 200 → 502/);
    expect(fs.readFileSync(env.caddyfile, "utf-8")).toBe(ORIGINAL);
  });

  it("rejects invalid content and private imports before proposing", async () => {
    const { etag } = (await call(session.client, "read")).r.structuredContent as { etag: string };
    const bad = await call(session.client, "propose_change", { content: ORIGINAL + "\nx.com {\n\tbogus\n}\n", base_etag: etag, summary: "x" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/unrecognized directive: bogus/);
    const leak = await call(session.client, "validate", { content: "import /home/caddy/.ssh/id_ed25519\n" });
    expect(leak.isError).toBe(true);
    expect(leak.text).toMatch(/only snippets and files under/);
  });

  it("flags risky whole-file changes", async () => {
    const { etag, content } = (await call(session.client, "read")).r.structuredContent as { etag: string; content: string };
    const p = await call(session.client, "propose_change", {
      content: content.replace(/keep\.example\.com \{[\s\S]*?\n}\n/, "").replace("security {", "security {\n\t\t# edited"),
      base_etag: etag,
      summary: "remove keep",
    });
    const codes = (p.r.structuredContent as { risks: { code: string }[] }).risks.map((r) => r.code).sort();
    expect(codes).toEqual(["global_options", "site_removed"]);
  });

  it("falls back to UI approval for clients without elicitation", async () => {
    const plain = await connect(writeToken, { era: "modern", elicitation: false });
    const p = await call(plain.client, "propose_site", { host: "new.example.com", template: "dokploy" });
    const id = (p.r.structuredContent as { proposal_id: string }).proposal_id;
    const first = await call(plain.client, "apply", { proposal_id: id });
    expect(first.isError).toBe(true);
    expect(first.text).toContain(`http://caddy.test:3000/changes?proposal=${id}`);
    await decide(id, "approved", "ui"); // the human clicks Approve in the UI
    expect((await call(plain.client, "apply", { proposal_id: id })).text).toMatch(/applied/);
    await plain.client.close();
  });
});
