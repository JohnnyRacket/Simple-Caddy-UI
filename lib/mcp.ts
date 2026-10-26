import {
  acceptedContent,
  inputRequired,
  inputResponse,
  McpServer,
  type AuthInfo,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import pkg from "@/package.json";
import { siteMap } from "./analyze";
import { adaptContent, formatCaddyfile, readWithEtag, validateContent } from "./caddyfile";
import { checkImports } from "./analyze";
import { checkDomain } from "./domain";
import { getSnapshot, listEntries, type Actor } from "./history";
import { recentLogs } from "./logs";
import { applyProposal, createProposal, decide, getProposal, ProposalError, type Proposal } from "./proposals";
import { removeSite, SiteError, upsertSite } from "./sites";

/** `chat`: approve in OpenChamber's form or the UI. `ui`: only the UI (needs your UI login). */
const APPROVAL_MODE = process.env.CADDY_MCP_APPROVAL === "ui" ? "ui" : "chat";

const INSTRUCTIONS = `Manages the live Caddyfile of a Caddy server that serves public sites.
Changes are never applied in one step:
1. Read the Caddyfile (read) to get its text and etag, or use list_sites for an overview.
2. Prepare a change with propose_change (whole file, needs base_etag), propose_site / propose_remove_site (one managed site), or propose_rollback. These validate and return a proposal with a diff and risk flags. Nothing is written.
3. Show the user the summary, the risk flags and the diff, and explain them.
4. Call apply with the proposal_id. The user approves it (an approval form, their client's permission prompt for apply, or the caddy-ui Changes page); only an approved proposal is applied, and a failed reload or a site that starts answering differently rolls it back automatically. Never call apply before showing the diff.
Proposal results include the diff and a review_url.
For new sites, run check_domain afterwards: DNS should point at this box and a certificate should be issued within a minute.
New apps deployed with Dokploy are reached through the dokploy template (import dokploy_proxy).`;

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const json = (v: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }], structuredContent: v as Record<string, unknown> });
const errorText = (err: unknown) => text(err instanceof Error ? err.message : String(err), true);

function actorFrom(authInfo: AuthInfo | undefined, ctx: ServerContext): Actor {
  const meta = ctx.mcpReq._meta as Record<string, unknown> | undefined;
  const sessionId = typeof meta?.["ai.opencode/sessionID"] === "string" ? (meta["ai.opencode/sessionID"] as string) : undefined;
  return { kind: "mcp", tokenId: String(authInfo?.extra?.tokenId ?? ""), tokenName: authInfo?.clientId ?? "unknown", sessionId };
}

function describeProposal(p: Proposal, baseUrl: string): string {
  const a = p.analysis;
  const sites = [
    a.added.length ? `added: ${a.added.join(", ")}` : "",
    a.removed.length ? `removed: ${a.removed.join(", ")}` : "",
    a.changed.length ? `changed: ${a.changed.join(", ")}` : "",
  ].filter(Boolean).join("; ") || "no site routes change";
  return [
    `Proposal ${p.id} (${p.status}) — ${p.summary}`,
    `Sites: ${sites}`,
    `Lines changed: ${a.changedLines}`,
    a.risks.length ? `Risk flags:\n${a.risks.map((r) => `  ⚠ ${r.message}`).join("\n")}` : "Risk flags: none",
    `Review/approve in the UI: ${baseUrl}/changes?proposal=${p.id}`,
    `Expires: ${p.expiresAt}`,
    "",
    a.diff,
  ].join("\n");
}

function supportsFormElicitation(server: McpServer, ctx: ServerContext): boolean {
  const caps = (ctx.mcpReq.envelope as { clientCapabilities?: { elicitation?: { form?: unknown } } } | undefined)?.clientCapabilities
    ?? (server.server.getClientCapabilities() as { elicitation?: { form?: unknown } } | undefined);
  const e = caps?.elicitation as Record<string, unknown> | undefined;
  // An empty elicitation object means form support in 2025-06-18 clients
  return !!e && (Object.keys(e).length === 0 || "form" in e);
}

const approvalSchema = z.object({
  approve: z.boolean().meta({ title: "Approve and apply this change to the live Caddyfile" }),
});

export function buildServer(authInfo: AuthInfo | undefined, requestInfo: Request | undefined): McpServer {
  const server = new McpServer({ name: "caddy", version: pkg.version }, { instructions: INSTRUCTIONS });
  const canWrite = authInfo?.scopes.includes("write") ?? false;
  const host = requestInfo?.headers.get("host") ?? (requestInfo ? new URL(requestInfo.url).host : "localhost:3000");
  const baseUrl = (process.env.PUBLIC_URL ?? `http://${host}`).replace(/\/$/, "");

  server.registerTool(
    "read",
    { description: "The live Caddyfile and its etag (pass the etag as base_etag to propose_change).", annotations: { readOnlyHint: true } },
    async () => {
      try {
        const { content, etag } = await readWithEtag();
        return { content: [{ type: "text", text: `etag: ${etag}\n\n${content}` }], structuredContent: { etag, content } };
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "list_sites",
    { description: "Every site host with what it does: handler and upstream, behind auth, rate limited, managed by this MCP, imported snippets.", annotations: { readOnlyHint: true } },
    async () => {
      try {
        const { content, etag } = await readWithEtag();
        const sites = [...siteMap(await adaptContent(content), content).values()].map((s) => ({ ...s, fingerprint: undefined }));
        return json({ etag, sites });
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "format",
    { description: "Format Caddyfile text with caddy fmt. Does not write anything.", inputSchema: z.object({ content: z.string().max(1_000_000) }), annotations: { readOnlyHint: true } },
    async ({ content }) => {
      try {
        return text(await formatCaddyfile(content));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "validate",
    { description: "Validate Caddyfile text with caddy validate, without writing it.", inputSchema: z.object({ content: z.string().max(1_000_000) }), annotations: { readOnlyHint: true } },
    async ({ content }) => {
      const guard = checkImports(content);
      if (guard.length) return text(guard.join("\n"), true);
      const r = await validateContent(content);
      return text(r.ok ? `Valid.\n${r.output}` : `Invalid.\n${r.output}`, !r.ok);
    },
  );

  server.registerTool(
    "logs",
    {
      description: "Recent Caddy log entries, newest last.",
      inputSchema: z.object({
        host: z.string().optional().describe("Only entries for this site host"),
        level: z.enum(["debug", "info", "warn", "error"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        return json({ entries: await recentLogs(args) });
      } catch (err) {
        return errorText(err);
      }
    },
  );

  server.registerTool(
    "history",
    { description: "Recent Caddyfile changes (newest first): who, when, outcome, sites touched, risk flags.", inputSchema: z.object({ limit: z.number().int().min(1).max(50).optional() }), annotations: { readOnlyHint: true } },
    async ({ limit }) => {
      const entries = await listEntries(limit ?? 10);
      return json({
        entries: entries.map((e) => ({
          id: e.id, at: e.at, actor: e.actor, summary: e.summary, outcome: e.outcome, message: e.message,
          touched: e.analysis?.touched, risks: e.analysis?.risks.map((r) => r.message),
        })),
      });
    },
  );

  server.registerTool(
    "check_domain",
    {
      description: "Is a host ready to serve: DNS points at this box, a valid certificate is served, and what HTTPS answers.",
      inputSchema: z.object({ host: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ host }) => {
      try {
        const { content } = await readWithEtag();
        const known = [...siteMap(await adaptContent(content), content).keys()];
        return json(await checkDomain(host.trim().toLowerCase(), known));
      } catch (err) {
        return errorText(err);
      }
    },
  );

  if (!canWrite) return server;

  const propose = async (content: string, baseEtag: string | undefined, summary: string, ctx: ServerContext) => {
    const { proposal, errors } = await createProposal(content, baseEtag, actorFrom(authInfo, ctx), summary);
    if (!proposal) return text(`Not proposed:\n${errors.join("\n")}`, true);
    return {
      content: [{ type: "text" as const, text: `${describeProposal(proposal, baseUrl)}\n\nShow the user this summary, the risk flags and the diff. Then call apply with proposal_id ${proposal.id}.` }],
      structuredContent: {
        proposal_id: proposal.id,
        status: proposal.status,
        summary: proposal.summary,
        risks: proposal.analysis.risks,
        added: proposal.analysis.added,
        removed: proposal.analysis.removed,
        changed: proposal.analysis.changed,
        changed_lines: proposal.analysis.changedLines,
        // Clients that only pass structured results on (e.g. Code Mode) still get the diff to show
        diff: proposal.analysis.diff,
        review_url: `${baseUrl}/changes?proposal=${proposal.id}`,
        expires_at: proposal.expiresAt,
      },
    };
  };

  server.registerTool(
    "propose_change",
    {
      description: "Propose a whole new Caddyfile. Validates it and returns a proposal (diff + risk flags). Writes nothing.",
      inputSchema: z.object({
        content: z.string().max(1_000_000).describe("The complete new Caddyfile"),
        base_etag: z.string().describe("etag from read; the proposal fails if the file changed since"),
        summary: z.string().max(300).describe("One line saying what the change does and why"),
      }),
    },
    async ({ content, base_etag, summary }, ctx) => propose(content, base_etag, summary, ctx),
  );

  server.registerTool(
    "propose_site",
    {
      description: "Propose adding or replacing one managed site (between caddy-mcp markers) without rewriting the file. Writes nothing.",
      inputSchema: z.object({
        host: z.string().describe("e.g. app.gloopert.com"),
        template: z.enum(["dokploy", "reverse_proxy"]).describe("dokploy: import dokploy_proxy (apps deployed with Dokploy). reverse_proxy: proxy to upstream"),
        upstream: z.string().optional().describe("For reverse_proxy: host:port, e.g. 192.168.1.50:8080"),
        rate_limit: z.boolean().optional().describe("Add import rate_limit"),
        auth: z.boolean().optional().describe("Put the site behind the auth portal"),
        summary: z.string().max(300).optional(),
      }),
    },
    async ({ host, template, upstream, rate_limit, auth, summary }, ctx) => {
      try {
        const { content, etag } = await readWithEtag();
        const result = upsertSite(content, { host, template, upstream, rateLimit: rate_limit, auth });
        return propose(result.content, etag, summary ?? `${result.replaced ? "Update" : "Add"} site ${host} (${template})`, ctx);
      } catch (err) {
        return err instanceof SiteError ? text(err.message, true) : errorText(err);
      }
    },
  );

  server.registerTool(
    "propose_remove_site",
    { description: "Propose removing a managed site. Writes nothing.", inputSchema: z.object({ host: z.string(), summary: z.string().max(300).optional() }) },
    async ({ host, summary }, ctx) => {
      try {
        const { content, etag } = await readWithEtag();
        return propose(removeSite(content, host), etag, summary ?? `Remove site ${host}`, ctx);
      } catch (err) {
        return err instanceof SiteError ? text(err.message, true) : errorText(err);
      }
    },
  );

  server.registerTool(
    "propose_rollback",
    {
      description: "Propose restoring the Caddyfile as it was before a change in history. Writes nothing.",
      inputSchema: z.object({ history_id: z.string().describe("id from history"), summary: z.string().max(300).optional() }),
    },
    async ({ history_id, summary }, ctx) => {
      const before = await getSnapshot(history_id, "before");
      if (before === null) return text(`no history entry ${history_id}`, true);
      const { etag } = await readWithEtag();
      return propose(before, etag, summary ?? `Roll back change ${history_id}`, ctx);
    },
  );

  server.registerTool(
    "apply",
    {
      description: "Apply a proposal after the user approves it. Asks the user; applies exactly the proposed text; rolls back automatically if the reload or a health check fails.",
      inputSchema: z.object({ proposal_id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ proposal_id }, ctx): Promise<CallToolResult | InputRequiredResult> => {
      try {
        let p = await getProposal(proposal_id);
        if (!p) return text(`no proposal ${proposal_id}`, true);

        // This token's client asks the human before running apply (its permission prompt is the approval)
        if (p.status === "pending" && APPROVAL_MODE === "chat" && authInfo?.extra?.approval === "client") {
          p = await decide(p.id, "approved", "client");
        }

        if (p.status === "pending" && APPROVAL_MODE === "chat") {
          const view = inputResponse(ctx.mcpReq.inputResponses, "approval");
          const answer = acceptedContent(ctx.mcpReq.inputResponses, "approval", approvalSchema);
          if (answer?.approve === true) {
            p = await decide(p.id, "approved", "chat");
          } else if (answer?.approve === false || (view.kind === "elicit" && view.action === "decline")) {
            await decide(p.id, "rejected", "chat");
            return text(`The user rejected proposal ${p.id}. Nothing was written.`);
          } else if (view.kind === "elicit" && view.action === "cancel") {
            return text(`The user dismissed the approval for ${p.id}; it is still pending. Ask before trying again.`);
          } else if (supportsFormElicitation(server, ctx)) {
            const a = p.analysis;
            return inputRequired({
              inputRequests: {
                approval: inputRequired.elicit({
                  message: [
                    `Apply this Caddyfile change? ${p.summary}`,
                    [a.added.length && `+ ${a.added.join(", ")}`, a.removed.length && `− ${a.removed.join(", ")}`, a.changed.length && `~ ${a.changed.join(", ")}`].filter(Boolean).join("   ") || "No site routes change",
                    a.risks.length ? a.risks.map((r) => `⚠ ${r.message}`).join("\n") : "No risk flags",
                    `${a.changedLines} line(s) changed. Full diff: ${baseUrl}/changes?proposal=${p.id}`,
                  ].join("\n"),
                  requestedSchema: approvalSchema,
                }),
              },
            });
          }
        }

        if (p.status === "pending") {
          return text(`Proposal ${p.id} needs approval. Ask the user to review and approve it at ${baseUrl}/changes?proposal=${p.id}, then call apply again.`, true);
        }
        if (p.status !== "approved") return text(`Proposal ${p.id} is ${p.status}${p.result ? `: ${p.result}` : ""}.`, p.status !== "applied");

        const { result } = await applyProposal(p.id, actorFrom(authInfo, ctx));
        return {
          content: [{ type: "text", text: `${result.ok ? "✓" : "✗"} ${result.outcome}: ${result.message}${result.historyId ? `\nHistory: ${result.historyId}` : ""}` }],
          structuredContent: { ok: result.ok, outcome: result.outcome, message: result.message, history_id: result.historyId ?? null },
          ...(!result.ok && result.outcome !== "noop" ? { isError: true } : {}),
        };
      } catch (err) {
        return err instanceof ProposalError ? text(err.message, true) : errorText(err);
      }
    },
  );

  return server;
}
