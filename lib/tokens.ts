import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { dataPath, newId, readJson, withLock, writeJson } from "./store";

export type Scope = "read" | "write";

/**
 * How `apply` gets the human's approval for this token's proposals.
 * chat:   the MCP approval form in the client, or the Changes page.
 * client: the client's own tool-permission prompt on `apply` (e.g. an OpenCode
 *         `ask` rule); the server applies without asking again.
 */
export type Approval = "chat" | "client";

export interface TokenRecord {
  id: string;
  name: string;
  scope: Scope;
  approval?: Approval; // absent = "chat"
  hash: string; // sha256 hex of the token; the token itself is shown once and never stored
  createdAt: string;
  lastUsedAt?: string;
}

const FILE = () => dataPath("tokens.json");
const PREFIX = "cmcp_";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listTokens(): Promise<TokenRecord[]> {
  return (await readJson<TokenRecord[]>(FILE())) ?? [];
}

export async function createToken(name: string, scope: Scope, approval: Approval = "chat"): Promise<{ token: string; record: TokenRecord }> {
  const clean = name.trim();
  if (!/^[\w .@-]{1,64}$/.test(clean)) throw new Error("name: 1–64 letters, digits, spaces, . @ _ -");
  const token = PREFIX + randomBytes(32).toString("base64url");
  return withLock("tokens", async () => {
    const all = await listTokens();
    if (all.some((t) => t.name === clean)) throw new Error(`a token named "${clean}" already exists`);
    const record: TokenRecord = { id: newId("tok"), name: clean, scope, approval, hash: hashToken(token), createdAt: new Date().toISOString() };
    await writeJson(FILE(), [...all, record]);
    return { token, record };
  });
}

export async function setApproval(id: string, approval: Approval): Promise<TokenRecord | null> {
  return withLock("tokens", async () => {
    const all = await listTokens();
    const rec = all.find((t) => t.id === id);
    if (!rec) return null;
    rec.approval = approval;
    await writeJson(FILE(), all);
    return rec;
  });
}

export async function revokeToken(id: string): Promise<boolean> {
  return withLock("tokens", async () => {
    const all = await listTokens();
    const rest = all.filter((t) => t.id !== id);
    if (rest.length === all.length) return false;
    await writeJson(FILE(), rest);
    return true;
  });
}

/** The record for a presented token, or null. Compares hashes in constant time. */
export async function verifyToken(token: string | undefined): Promise<TokenRecord | null> {
  if (!token?.startsWith(PREFIX)) return null;
  const presented = Buffer.from(hashToken(token), "hex");
  const all = await listTokens();
  const match = all.find((t) => timingSafeEqual(Buffer.from(t.hash, "hex"), presented));
  if (!match) return null;
  // Best effort; at most once a minute so tool calls don't serialize on the file
  const last = match.lastUsedAt ? Date.parse(match.lastUsedAt) : 0;
  if (Date.now() - last > 60_000) {
    void withLock("tokens", async () => {
      const fresh = await listTokens();
      const rec = fresh.find((t) => t.id === match.id);
      if (rec) {
        rec.lastUsedAt = new Date().toISOString();
        await writeJson(FILE(), fresh);
      }
    }).catch(() => {});
  }
  return match;
}
