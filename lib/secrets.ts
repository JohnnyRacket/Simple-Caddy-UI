// Hides secret values (OAuth client secrets, API tokens, basic_auth hashes,
// Authorization headers) from MCP clients. Each secret becomes [REDACTED:n].
// A candidate gets the real values back only if every block holding one is
// unchanged and in the same place, so a client can't send a secret it never
// saw somewhere new: into a response body, to another upstream, or to a
// different identity provider URL next to it.

const SECRET_KEYS = new Set([
  "client_secret", "secret", "secret_key", "shared_secret", "token_secret", "jwt_secret", "hmac_key", "private_key",
  "password", "passwd", "api_key", "apikey", "api_token", "auth_token", "access_token",
]);
const HEADER_DIRECTIVES = new Set(["header", "header_up", "header_down", "request_header"]);
const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "cookie"]);
const BASIC_AUTH = new Set(["basic_auth", "basicauth"]);

const PLACEHOLDER = /\[REDACTED:(\d+)\]/g;
const placeholder = (n: number) => `[REDACTED:${n}]`;

export class SecretError extends Error {}

interface Token {
  text: string;
  start: number;
  end: number;
}

interface Scan {
  lines: string[];
  secrets: { line: number; token: Token }[];
  /** Per line: the path of blocks around it and the whole innermost block, normalized */
  context: string[];
}

const unquote = (t: string) => t.replace(/^(["`])([\s\S]*)\1$/, "$2");
const normalize = (l: string) => l.trim().replace(/\s+/g, " ");

/** Values Caddy fills in at runtime ({$VAR}, {env.VAR}) hold no secret themselves. */
const isReference = (t: string) => /\{\$|\{env\./.test(t) || /^\{[^{}\s]+\}$/.test(unquote(t));

function lineTokens(line: string, offset: number): Token[] {
  const out: Token[] = [];
  for (const m of line.matchAll(/"(?:\\.|[^"\\])*"|`[^`]*`|\S+/g)) {
    if (m[0].startsWith("#")) break;
    out.push({ text: m[0], start: offset + m.index, end: offset + m.index + m[0].length });
  }
  return out;
}

/** Indexes of the tokens on one directive line that hold secrets. */
function secretTokens(tokens: string[], inBasicAuth: boolean): number[] {
  if (tokens.length < 2) return [];
  const head = tokens[0].toLowerCase();
  const last = tokens.length - 1;
  const pick = (...idx: number[]) => idx.filter((i) => i <= last && tokens[i] !== "{" && !isReference(tokens[i]));

  if (inBasicAuth) return pick(...tokens.slice(1).map((_, i) => i + 1));
  if (SECRET_KEYS.has(head)) return pick(last);
  if (head === "dns" && tokens.length >= 3) return pick(last);
  if (HEADER_DIRECTIVES.has(head)) {
    const i = tokens.findIndex((t, j) => j > 0 && SECRET_HEADERS.has(unquote(t).replace(/^[+-]/, "").toLowerCase()));
    return i > 0 ? pick(i + 1) : [];
  }
  if (head === "crypto") {
    const i = tokens.findIndex((t) => t === "sign-verify" || t === "sign" || t === "verify");
    return i > 0 && tokens[i + 1] !== "from" ? pick(i + 1) : [];
  }
  return [];
}

/**
 * Find every secret and the block it sits in. Comments are scanned too
 * (commented-out config often still holds a live secret) but don't open or
 * close blocks.
 */
function scan(content: string): Scan {
  const lines = content.split("\n");
  const secrets: Scan["secrets"] = [];
  const blocks: { path: string; start: number; end: number }[] = [];
  const owner: number[] = [];
  const stack: number[] = [];

  lines.forEach((raw, idx) => {
    const comment = /^\s*#+/.exec(raw);
    const tokens = lineTokens(comment ? raw.slice(comment[0].length) : raw, comment?.[0].length ?? 0);
    const texts = tokens.map((t) => t.text);
    const inner = stack.length ? blocks[stack.at(-1)!] : undefined;
    const innerHead = inner ? normalize(lines[inner.start]).split(" ")[0].toLowerCase() : "";
    for (const i of secretTokens(texts, BASIC_AUTH.has(innerHead))) secrets.push({ line: idx, token: tokens[i] });
    owner.push(stack.at(-1) ?? -1);
    if (comment) return;
    for (const t of texts) {
      if (t === "}" && stack.length) blocks[stack.pop()!].end = idx;
    }
    if (texts.at(-1) === "{") {
      const path = stack.map((b) => normalize(lines[blocks[b].start])).join(" > ");
      stack.push(blocks.push({ path, start: idx, end: lines.length - 1 }) - 1);
    }
  });

  const blockText = blocks.map((b) => `${b.path}\n${lines.slice(b.start, b.end + 1).map(normalize).filter(Boolean).join("\n")}`);
  const context = lines.map((l, idx) => `${owner[idx] === -1 ? "" : blockText[owner[idx]]}\n${normalize(l)}`);
  return { lines, secrets, context };
}

/**
 * Replace every secret with [REDACTED:n]. The same value always gets the same
 * number; pass the numbering from one file to the next to keep a diff stable.
 */
export function redactSecrets(content: string, numbering = new Map<string, number>()): { content: string; count: number; numbering: Map<string, number> } {
  const { lines, secrets } = scan(content);
  const out = [...lines];
  for (const { line, token } of [...secrets].sort((a, b) => b.token.start - a.token.start)) {
    if (!numbering.has(token.text)) numbering.set(token.text, numbering.size + 1);
    out[line] = out[line].slice(0, token.start) + placeholder(numbering.get(token.text)!) + out[line].slice(token.end);
  }
  return { content: out.join("\n"), count: secrets.length, numbering };
}

/**
 * Put the real values back into a candidate written against the redacted
 * form of `original`. Throws unless every line holding a placeholder is
 * unchanged, in an unchanged block at the same place.
 */
export function restoreSecrets(candidate: string, original: string): string {
  if (!candidate.includes("[REDACTED:")) return candidate;
  const redacted = redactSecrets(original);
  const values = new Map([...redacted.numbering].map(([value, n]) => [n, value]));

  const before = scan(redacted.content);
  const allowed = new Map<string, number>();
  for (const line of new Set(before.secrets.map((s) => s.line))) {
    allowed.set(before.context[line], (allowed.get(before.context[line]) ?? 0) + 1);
  }

  const after = scan(candidate);
  return after.lines
    .map((line, idx) => {
      if (!line.includes("[REDACTED:")) return line;
      const where = `line ${idx + 1}`;
      for (const m of line.matchAll(PLACEHOLDER)) {
        if (!values.has(Number(m[1]))) throw new SecretError(`${where}: ${m[0]} is not a secret in the live Caddyfile; read it again.`);
      }
      const left = allowed.get(after.context[idx]) ?? 0;
      if (left === 0) {
        throw new SecretError(
          `${where}: "${normalize(line)}" holds a redacted secret, and it or the block around it was changed or moved. ` +
            "Keep blocks with [REDACTED:n] exactly as read, or make this change in the caddy-ui editor.",
        );
      }
      allowed.set(after.context[idx], left - 1);
      const restored = line.replace(PLACEHOLDER, (_, n) => values.get(Number(n))!);
      if (restored.includes("[REDACTED:")) throw new SecretError(`${where}: malformed [REDACTED:n] placeholder`);
      return restored;
    })
    .join("\n");
}

/** Replace secret values from `content` wherever they appear in free text, e.g. Caddy's error output. */
export function scrubSecrets(text: string, content: string): string {
  const { numbering } = redactSecrets(content);
  let out = text;
  for (const [token, n] of [...numbering].sort((a, b) => b[0].length - a[0].length)) {
    for (const value of new Set([token, unquote(token)])) {
      if (value.length >= 4) out = out.split(value).join(placeholder(n));
    }
  }
  return out;
}
