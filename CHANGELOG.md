# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
