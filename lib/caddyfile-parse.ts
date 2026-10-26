// Minimal Caddyfile structure parser: just enough to find top-level blocks,
// managed regions and `import` directives. Caddy itself stays the authority on
// validity; this only has to agree with it on where blocks start and end.

export interface Token {
  text: string;
  line: number; // 0-based
  quoted: boolean;
}

export type EntryKind = "global" | "snippet" | "named_route" | "site";

export interface Entry {
  kind: EntryKind;
  /** Site addresses, or the snippet / named route name */
  keys: string[];
  startLine: number; // 0-based, inclusive
  endLine: number; // 0-based, inclusive
  text: string;
}

export interface ManagedRegion {
  host: string;
  beginLine: number;
  endLine: number;
}

export interface ImportRef {
  arg: string;
  line: number;
}

export class ParseError extends Error {
  constructor(message: string, public line: number) {
    super(`line ${line + 1}: ${message}`);
    this.name = "ParseError";
  }
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }

    const startLine = line;
    if (c === '"' || c === "`") {
      const q = c;
      let text = "";
      i++;
      while (i < n && src[i] !== q) {
        if (q === '"' && src[i] === "\\" && src[i + 1] === '"') { text += '"'; i += 2; continue; }
        if (src[i] === "\n") line++;
        text += src[i++];
      }
      if (i >= n) throw new ParseError(`unterminated ${q === '"' ? "quoted string" : "backtick string"}`, startLine);
      i++;
      tokens.push({ text, line: startLine, quoted: true });
      continue;
    }

    // Heredoc: <<MARKER ... MARKER. More tokens may follow the closing marker (`MARKER 200`).
    const heredoc = /^<<([A-Za-z0-9_-]+)[ \t]*\r?\n/.exec(src.slice(i, i + 64));
    if (heredoc) {
      const marker = heredoc[1];
      i += heredoc[0].length;
      line++;
      const body: string[] = [];
      for (;;) {
        if (i >= n) throw new ParseError(`unterminated heredoc <<${marker}`, startLine);
        const end = src.indexOf("\n", i);
        const lineText = end === -1 ? src.slice(i) : src.slice(i, end);
        const close = new RegExp(`^([ \\t]*)${marker}(?=\\s|$)`).exec(lineText);
        if (close) {
          i += close[0].length; // continue tokenizing after the marker
          break;
        }
        body.push(lineText);
        i = end === -1 ? n : end + 1;
        line++;
      }
      tokens.push({ text: body.join("\n"), line: startLine, quoted: true });
      continue;
    }

    let text = "";
    while (i < n && !/\s/.test(src[i])) {
      if (src[i] === "\\" && i + 1 < n && !/\s/.test(src[i + 1])) { text += src[i] + src[i + 1]; i += 2; continue; }
      text += src[i++];
    }
    tokens.push({ text, line: startLine, quoted: false });
  }
  return tokens;
}

const isOpen = (t: Token) => !t.quoted && t.text === "{";
const isClose = (t: Token) => !t.quoted && t.text === "}";

/** Top-level blocks in file order. */
export function parseEntries(src: string): Entry[] {
  const tokens = tokenize(src);
  const lines = src.split("\n");
  const entries: Entry[] = [];
  let i = 0;

  const slice = (a: number, b: number) => lines.slice(a, b + 1).join("\n");

  // Global options block: a lone `{` as the very first token
  if (tokens.length && isOpen(tokens[0])) {
    const end = matchBrace(tokens, 0);
    entries.push({ kind: "global", keys: [], startLine: tokens[0].line, endLine: tokens[end].line, text: slice(tokens[0].line, tokens[end].line) });
    i = end + 1;
  }

  while (i < tokens.length) {
    const start = i;
    const keys: string[] = [];
    // Collect keys up to the opening brace. Addresses may span lines when separated by commas.
    while (i < tokens.length && !isOpen(tokens[i])) {
      if (isClose(tokens[i])) throw new ParseError("unexpected '}'", tokens[i].line);
      const prev = tokens[i - 1];
      if (i > start && tokens[i].line !== prev.line && !prev.text.endsWith(",")) break;
      keys.push(...tokens[i].text.split(",").map((s) => s.trim()).filter(Boolean));
      i++;
    }
    if (i >= tokens.length || !isOpen(tokens[i])) {
      // A site without braces: only legal as the sole site, running to EOF
      const last = tokens[tokens.length - 1];
      entries.push({ kind: "site", keys, startLine: tokens[start].line, endLine: last.line, text: slice(tokens[start].line, last.line) });
      break;
    }
    const end = matchBrace(tokens, i);
    const startLine = tokens[start].line;
    const endLine = tokens[end].line;
    const kind: EntryKind =
      keys.length === 1 && /^\(.+\)$/.test(keys[0]) ? "snippet"
      : keys.length === 1 && /^&\(.+\)$/.test(keys[0]) ? "named_route"
      : "site";
    const names = kind === "snippet" ? [keys[0].slice(1, -1)] : kind === "named_route" ? [keys[0].slice(2, -1)] : keys;
    entries.push({ kind, keys: names, startLine, endLine, text: slice(startLine, endLine) });
    i = end + 1;
  }
  return entries;
}

function matchBrace(tokens: Token[], openIdx: number): number {
  let depth = 0;
  for (let j = openIdx; j < tokens.length; j++) {
    if (isOpen(tokens[j])) depth++;
    else if (isClose(tokens[j])) {
      depth--;
      if (depth === 0) return j;
    }
  }
  throw new ParseError("unclosed '{'", tokens[openIdx].line);
}

/** Every `import` directive (at line start) with its first argument. */
export function findImports(src: string): ImportRef[] {
  const tokens = tokenize(src);
  const refs: ImportRef[] = [];
  for (let j = 0; j < tokens.length - 1; j++) {
    const t = tokens[j];
    const lineStart = j === 0 || tokens[j - 1].line !== t.line;
    if (lineStart && !t.quoted && t.text === "import") refs.push({ arg: tokens[j + 1].text, line: t.line });
  }
  return refs;
}

const BEGIN = /^\s*#\s*caddy-mcp:begin\s+(\S+)\s*$/;
const END = /^\s*#\s*caddy-mcp:end\s+(\S+)\s*$/;

export function findManagedRegions(src: string): ManagedRegion[] {
  const lines = src.split("\n");
  const regions: ManagedRegion[] = [];
  let open: { host: string; line: number } | null = null;
  lines.forEach((l, idx) => {
    const b = BEGIN.exec(l);
    const e = END.exec(l);
    if (b) {
      if (open) throw new ParseError(`caddy-mcp:begin ${b[1]} inside managed block ${open.host}`, idx);
      open = { host: b[1], line: idx };
    } else if (e) {
      if (!open || open.host !== e[1]) throw new ParseError(`caddy-mcp:end ${e[1]} without matching begin`, idx);
      regions.push({ host: open.host, beginLine: open.line, endLine: idx });
      open = null;
    }
  });
  if (open) throw new ParseError(`caddy-mcp:begin ${(open as { host: string }).host} never ended`, (open as { line: number }).line);
  return regions;
}

export const markerBegin = (host: string) => `# caddy-mcp:begin ${host}`;
export const markerEnd = (host: string) => `# caddy-mcp:end ${host}`;
