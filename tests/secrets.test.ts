import { describe, expect, it } from "vitest";
import { redactSecrets, restoreSecrets, scrubSecrets, SecretError } from "@/lib/secrets";

const FILE = `{
	security {
		oauth identity provider generic {
			client_id 89a440ac
			client_secret 8GzWeMD4z8i3o2ZQ
			base_auth_url https://auth.example.com
		}
		authentication portal myportal {
			crypto key sign-verify "jwt signing key"
		}
	}
	acme_dns cloudflare {env.CF_TOKEN}
}

api.example.com {
	basic_auth {
		alice $2a$14$hashhashhash
	}
	reverse_proxy 10.0.0.5:80 {
		header_up Authorization "Bearer upstream-token"
	}
}

tls.example.com {
	tls {
		dns cloudflare cf-raw-token
	}
	respond "hi"
}

# old.example.com {
#	header_up X-Api-Key old-key-1234
# }
`;

const SECRETS = ["8GzWeMD4z8i3o2ZQ", "jwt signing key", "$2a$14$hashhashhash", "upstream-token", "cf-raw-token", "old-key-1234"];

describe("redactSecrets", () => {
  it("hides every secret and keeps everything else", () => {
    const { content, count } = redactSecrets(FILE);
    for (const s of SECRETS) expect(content).not.toContain(s);
    expect(count).toBe(6);
    expect(content).toContain("client_secret [REDACTED:");
    expect(content).toContain("client_id 89a440ac");
    expect(content).toContain("alice [REDACTED:");
    expect(content).toContain("header_up Authorization [REDACTED:");
    expect(content).toContain("{env.CF_TOKEN}"); // a reference, not a secret
  });

  it("gives the same value the same number", () => {
    const twice = "a.com {\n\tbasic_auth {\n\t\tbob same-hash\n\t}\n}\nb.com {\n\tbasic_auth {\n\t\tbob same-hash\n\t}\n}\n";
    expect(redactSecrets(twice).content.match(/\[REDACTED:1\]/g)).toHaveLength(2);
  });

  it("leaves a file without secrets alone", () => {
    const plain = "x.com {\n\trate_limit {\n\t\tkey {remote_host}\n\t}\n}\n";
    expect(redactSecrets(plain)).toMatchObject({ content: plain, count: 0 });
  });
});

describe("restoreSecrets", () => {
  const redacted = redactSecrets(FILE).content;

  it("restores the original exactly", () => {
    expect(restoreSecrets(redacted, FILE)).toBe(FILE);
  });

  it("keeps secrets through edits elsewhere, reindenting and new sites", () => {
    const edited = redacted.replace('respond "hi"', 'respond "hello"').replace(/\t/g, "    ") + "\nnew.example.com {\n\trespond ok\n}\n";
    const restored = restoreSecrets(edited, FILE);
    for (const s of SECRETS) expect(restored).toContain(s);
    expect(restored).toContain('respond "hello"');
  });

  it("refuses to move a secret somewhere new", () => {
    const leak = redacted + "\nevil.example.com {\n\trespond [REDACTED:1]\n}\n";
    expect(() => restoreSecrets(leak, FILE)).toThrow(SecretError);
  });

  it("refuses to change the block around a secret", () => {
    const repointed = redacted.replace("https://auth.example.com", "https://attacker.example");
    expect(() => restoreSecrets(repointed, FILE)).toThrow(/block around it/);
    const reupstream = redacted.replace("reverse_proxy 10.0.0.5:80 {", "reverse_proxy attacker.example:80 {");
    expect(() => restoreSecrets(reupstream, FILE)).toThrow(SecretError);
  });

  it("refuses to duplicate a secret line or use an unknown number", () => {
    const dup = redacted.replace(/(\t\t\tclient_secret .*\n)/, "$1$1");
    expect(() => restoreSecrets(dup, FILE)).toThrow(SecretError);
    expect(() => restoreSecrets(redacted.replace("[REDACTED:1]", "[REDACTED:99]"), FILE)).toThrow(/not a secret/);
  });

  it("allows replacing a secret with an environment reference", () => {
    const moved = redacted.replace(/client_secret \S+/, "client_secret {env.OAUTH_SECRET}");
    const restored = restoreSecrets(moved, FILE);
    expect(restored).toContain("client_secret {env.OAUTH_SECRET}");
    expect(restored).not.toContain("8GzWeMD4z8i3o2ZQ");
    expect(restored).toContain("upstream-token");
  });
});

describe("scrubSecrets", () => {
  it("replaces secret values in free text", () => {
    const out = scrubSecrets("error near client_secret 8GzWeMD4z8i3o2ZQ and 'jwt signing key'", FILE);
    expect(out).not.toContain("8GzWeMD4z8i3o2ZQ");
    expect(out).not.toContain("jwt signing key");
    expect(out).toContain("[REDACTED:1]");
  });
});
