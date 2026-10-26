# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.2.1] — 2026-10-26

### Added

- Per-token approval mode: **client's permission prompt**, for clients whose MCP approval form can't be answered (OpenChamber running Claude Code files it under a `global` session and fails to submit). The client's `ask` rule on `caddy_apply` is the approval; switch modes on the MCP tokens page.

### Fixed

- Proposal and apply results carry the diff, review link and outcome as structured content, so clients that only pass structured results on (OpenCode Code Mode) can show the diff.

## [1.2.0] — 2026-10-26

### Added

- **MCP server** at `/api/mcp` (official TypeScript SDK v2, Streamable HTTP): read, list_sites, format, validate, logs, history, check_domain, and propose_change / propose_site / propose_remove_site / propose_rollback → apply. Scoped `read`/`write` tokens, created on the new **MCP tokens** page.
- **Approval before every change**: proposals carry a diff and risk flags; `apply` asks through an MCP approval form (2026-07-28 protocol clients) or the new **Changes** page, and applies exactly the approved text.
- **Safe saves** for the editor and agents alike: version check (ETag), validate before writing, snapshot, reload, confirm Caddy runs the new config, health-check untouched sites, automatic rollback. Change history with diffs and restore.
- Tests: unit and MCP flow tests (`npm test`) and an integration suite against real Caddy in Docker (`npm run test:integration`).

### Changed

- Validate checks the editor's text (not the file on disk); Save validates, writes and reloads in one step.
- Sudoers: validation reads from stdin (`caddy validate --config - --adapter caddyfile`), plus `journalctl -n 500 -o json` for the logs tool. New data directory `/var/lib/caddy-ui`. `scripts/deploy.sh` installs both.

### Security

- Child processes run with a minimal environment, so `{$SECRET_TOKEN}`-style placeholders can't leak the app's secrets through `caddy adapt`.
- Agent-submitted Caddyfiles may only import snippets or files under `/etc/caddy`, and may not bind Caddy's admin port or change the `admin` option (a site on the admin port makes later reloads silently do nothing).

## [1.1.1] — 2026-10-25

### Fixed

- **Login blocked with 403 over plain HTTP.** Browsers only send `Sec-Fetch-Site` to HTTPS/localhost, and `Referrer-Policy: no-referrer` made them send `Origin: null` on the login form, which the CSRF check rejected. The policy is now `same-origin`.

### Added

- `scripts/deploy.sh` — update a self-hosted install with build-aside, smoke tests and automatic rollback.
- `GET /api/health` (authenticated) — reports the version and git commit being served.

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
