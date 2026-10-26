# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.1.0] — 2026-10-25

### Security

- **LAN guard bypass fixed** — `next start` keeps a client-supplied `X-Forwarded-For`, so anyone could claim a LAN address. A small custom server (`server.mjs`) now pins the client IP to the TCP peer; set `TRUSTED_PROXIES` when running behind a reverse proxy.
- **Sudoers privilege escalation fixed** — the `cp /tmp/caddyfile-*/Caddyfile` rule's wildcard let the app user pass extra arguments to `cp` as root. Saving now pipes content to `sudo tee /etc/caddy/Caddyfile` with an exact-argument rule. **Update `/etc/sudoers.d/caddy-ui`** (see README).
- **Validation no longer runs as root** — `caddy validate` runs as the `caddy` user via `sudo -u caddy`.
- **Auth is required** — a missing `SECRET_TOKEN` now fails closed (503) instead of disabling auth. `DISABLE_AUTH=true` opts out explicitly.
- **CSRF protection** — state-changing requests from another origin (including other ports or subdomains, which `SameSite` treats as same-site) are rejected.
- **Session cookie no longer contains the secret** — it holds an HMAC derived from it, expires after 7 days, and is `Secure` behind HTTPS. Existing sessions must log in again.
- Constant-time token checks in the proxy; rate limiter memory is bounded; login/logout redirects no longer trust the `Host` header.
- Dependencies updated (Next 16.4, React 19.3, lucide 1.x and more); `npm audit` is clean.

### Changed

- `npm start` / `npm run dev` run `node server.mjs`. The server listens on all interfaces (IPv4 + IPv6) by default; `HOST` binds one address.
- `CP_BIN` replaced by `TEE_BIN`; new `CADDY_USER`.

## [1.0.0] — 2026-03-04

### Initial release

- **Editor** — CodeMirror-based Caddyfile editor with syntax highlighting
- **Validate** — Run `caddy validate` against the live Caddyfile
- **Format** — Run `caddy fmt` to auto-format the Caddyfile
- **Reload** — Trigger `systemctl reload caddy` from the UI
- **Log viewer** — Live log tail via `journalctl -u caddy -f` streamed over SSE
- **Auth** — Optional shared-secret token auth (cookie + Bearer header)
- **LAN guard** — Middleware blocks non-LAN IPs by default (`LOCAL_ONLY`)
- **Rate limiting** — In-memory sliding window rate limiter on mutating endpoints
- **Docker dev environment** — Compose setup with fake systemctl/journalctl for local testing
