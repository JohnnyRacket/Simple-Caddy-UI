import { describe, expect, it } from "vitest";
import { findImports, findManagedRegions, parseEntries, tokenize } from "@/lib/caddyfile-parse";

const SAMPLE = `# leading comment
{
	order authenticate before respond
	security {
		authentication portal myportal {
			crypto default token lifetime 86400
		}
		authorization policy mypolicy {
			allow roles user
		}
	}
}

(rate_limit) {
	rate_limit {
		zone dynamic {
			key {remote_host}
			events 1000
			window 1m
		}
	}
}

(dokploy_proxy) {
	reverse_proxy 192.168.1.125:80
}

a.example.com, b.example.com {
	import dokploy_proxy
	respond "has { braces } and # not a comment" 200
}

c.example.com {
	# a { brace in a comment
	respond <<EOF
		{ heredoc braces }
		EOF 200
}
`;

describe("caddyfile parser", () => {
  it("finds global options, snippets and sites", () => {
    const entries = parseEntries(SAMPLE);
    expect(entries.map((e) => [e.kind, e.keys])).toEqual([
      ["global", []],
      ["snippet", ["rate_limit"]],
      ["snippet", ["dokploy_proxy"]],
      ["site", ["a.example.com", "b.example.com"]],
      ["site", ["c.example.com"]],
    ]);
    const c = entries[4];
    expect(SAMPLE.split("\n")[c.endLine]).toBe("}");
  });

  it("treats placeholders, quoted braces, comments and heredocs as content", () => {
    const toks = tokenize(`x {\n\trespond "{ }" {host}\n}\n`).map((t) => t.text);
    expect(toks).toEqual(["x", "{", "respond", "{ }", "{host}", "}"]);
  });

  it("collects imports", () => {
    expect(findImports(SAMPLE).map((i) => i.arg)).toEqual(["dokploy_proxy"]);
  });

  it("reports unclosed blocks with a line number", () => {
    expect(() => parseEntries("a.com {\n\trespond hi\n")).toThrow(/line 1: unclosed/);
  });

  it("finds managed regions and rejects broken markers", () => {
    const src = "# caddy-mcp:begin x.com\nx.com {\n}\n# caddy-mcp:end x.com\n";
    expect(findManagedRegions(src)).toEqual([{ host: "x.com", beginLine: 0, endLine: 3 }]);
    expect(() => findManagedRegions("# caddy-mcp:begin x.com\n")).toThrow(/never ended/);
    expect(() => findManagedRegions("# caddy-mcp:end x.com\n")).toThrow(/without matching begin/);
  });

  it("supports a single site without braces", () => {
    expect(parseEntries(":80\nrespond hi\n").map((e) => e.kind)).toEqual(["site"]);
  });
});
