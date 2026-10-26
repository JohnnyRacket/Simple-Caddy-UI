import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "__auth";

/** Constant-time string comparison that doesn't leak length either. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Value stored in the session cookie. Derived from the secret so the secret
 * itself (also usable as a Bearer token) never sits in the browser.
 * Rotating SECRET_TOKEN invalidates every session.
 */
export function sessionValue(secret: string): string {
  return createHmac("sha256", secret).update("caddy-ui-session-v1").digest("base64url");
}

/** Relative 303 so a POST lands on a GET, without trusting the Host header. */
export function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}
