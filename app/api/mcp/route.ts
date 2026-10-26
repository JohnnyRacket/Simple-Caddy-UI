import { createMcpHandler, type McpHttpHandler } from "@modelcontextprotocol/server";
import { buildServer } from "@/lib/mcp";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { verifyToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const g = globalThis as typeof globalThis & { __caddyMcpHandler?: McpHttpHandler };
const handler = (g.__caddyMcpHandler ??= createMcpHandler(({ authInfo, requestInfo }) => buildServer(authInfo, requestInfo)));

const unauthorized = () =>
  new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="caddy-ui"' } });

async function serve(req: Request): Promise<Response> {
  if (!checkRateLimit(`mcp:${getClientIp(req)}`, 240, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const record = await verifyToken(token);
  if (!record || !token) return unauthorized();
  return handler.fetch(req, {
    authInfo: { token, clientId: record.name, scopes: [record.scope], extra: { tokenId: record.id } },
  });
}

export { serve as GET, serve as POST, serve as DELETE };
