# Simple Caddy UI

A Next.js management UI for [Caddy](https://caddyserver.com/) — edit your Caddyfile, validate, format, reload, and tail logs from a browser. It also serves an [MCP](https://modelcontextprotocol.io/) endpoint, so an AI agent can propose Caddyfile changes that you approve before they go live.

---

<img width="870" height="811" alt="Image" src="https://github.com/user-attachments/assets/ad734469-4937-4975-85ce-58b370f0298f" />

## Try It Out (Docker)

The quickest way to kick the tires before committing to a full install. Requires [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```bash
git clone https://github.com/JohnnyRacket/Simple-Caddy-UI.git caddy-ui
cd caddy-ui
docker compose up
```

Open [http://localhost:3000](http://localhost:3000) for the UI and [http://localhost:8080](http://localhost:8080) for the Caddy web server. Runs in dev mode against a sandboxed Caddy instance — no changes to your host system.

The Docker environment uses `SECRET_TOKEN=password` by default. Visit [http://localhost:3000/login](http://localhost:3000/login) and enter `password` to authenticate. To use a different token, set `SECRET_TOKEN` in a `.env` file at the project root before running `docker compose up`.

---

## Self-Hosted Setup

These instructions are for deploying on a Linux machine (e.g. Raspberry Pi) that is already running Caddy.

### 1. Install Node.js 24 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version  # should be v24.x
```

### 2. Create a Dedicated Service User

Running the app as a dedicated system user limits the blast radius if anything goes wrong.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin caddy-ui
```

### 3. Clone & Build

```bash
sudo git clone https://github.com/JohnnyRacket/Simple-Caddy-UI.git /opt/caddy-ui
sudo chown -R caddy-ui:caddy-ui /opt/caddy-ui
cd /opt/caddy-ui

sudo -u caddy-ui npm install

# Create env file — adjust path if your Caddyfile is elsewhere
# Generate a strong token with: openssl rand -hex 32
sudo -u caddy-ui tee /opt/caddy-ui/.env.local << 'EOF'
CADDYFILE_PATH=/etc/caddy/Caddyfile
SECRET_TOKEN=your-secret-token-here
EOF

sudo -u caddy-ui npm run build
```

> **`SECRET_TOKEN` is required.** Without it the app answers every request with `503`. (Set `DISABLE_AUTH=true` only if you really want an unauthenticated UI.)

> **`LOCAL_ONLY`** — by default the app rejects requests from non-LAN IPs, judged by the real TCP peer address (a client-sent `X-Forwarded-For` is ignored). If you put the UI behind a reverse proxy such as Caddy, list the proxy's address in `TRUSTED_PROXIES` (e.g. `TRUSTED_PROXIES=127.0.0.1,::1`) so the client IP it forwards is used instead. `LOCAL_ONLY=false` turns the check off.

> **`HOST`** — the server listens on all interfaces (IPv4 and IPv6) by default. Set `HOST=192.168.1.10` (or `::`, `127.0.0.1`, …) to bind to one address.

> **Binary path overrides** — the app defaults to standard Debian/Ubuntu paths (`/bin/cp`, `/usr/bin/caddy`, `/bin/systemctl`, `/usr/bin/journalctl`). On other distros, override them in `.env.local`:
> ```
> TEE_BIN=/usr/bin/tee
> CADDY_BIN=/usr/local/bin/caddy
> SYSTEMCTL_BIN=/usr/bin/systemctl
> JOURNALCTL_BIN=/usr/bin/journalctl
> CADDY_USER=caddy   # user that runs Caddy; validation runs as this user
> ```

### 4. Configure Sudoers

The app needs passwordless `sudo` for a few specific commands.

```bash
sudo visudo -f /etc/sudoers.d/caddy-ui
```

Paste the following, then save and exit:

```
caddy-ui ALL=(root) NOPASSWD: /usr/bin/tee /etc/caddy/Caddyfile
caddy-ui ALL=(root) NOPASSWD: /bin/systemctl reload caddy
caddy-ui ALL=(caddy) NOPASSWD: /usr/bin/caddy validate --config - --adapter caddyfile
caddy-ui ALL=(root) NOPASSWD: /usr/bin/journalctl -u caddy -f --no-pager -o short-iso
caddy-ui ALL=(root) NOPASSWD: /usr/bin/journalctl -u caddy -n 500 --no-pager -o json
```

Every rule names its exact arguments — no wildcards. (A `*` in a sudoers rule matches spaces too, so a rule like `/bin/cp /tmp/caddyfile-*/Caddyfile …` lets the app user smuggle in extra arguments and copy files anywhere as root.) Validation reads the candidate Caddyfile from stdin and runs as the `caddy` user rather than root, since a Caddyfile can `import` any path and parse errors echo its contents.

Create the data directory (MCP tokens, proposals, change history):

```bash
sudo install -d -o caddy-ui -g caddy-ui -m 700 /var/lib/caddy-ui
```

Verify it works:

```bash
sudo -u caddy-ui sudo /bin/systemctl reload caddy
```

### 5. Create a Systemd Service

This keeps the app running and restarts it on failure.

```bash
sudo nano /etc/systemd/system/caddy-ui.service
```

Next.js automatically loads `.env.local` at startup, so no extra environment configuration is needed in the service file. To change the port, set `PORT=<number>` in `.env.local` — Next.js reads it natively.

```ini
[Unit]
Description=Caddy UI
After=network.target

[Service]
Type=simple
User=caddy-ui
WorkingDirectory=/opt/caddy-ui
ExecStart=/usr/bin/npm start
Restart=on-failure
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now caddy-ui

# Check it's running
sudo systemctl status caddy-ui
```

Once running, the UI is available at `http://<machine-ip>:3000` from any device on your local network.

---

## Updating

```bash
sudo bash /opt/caddy-ui/scripts/deploy.sh            # latest main
sudo bash /opt/caddy-ui/scripts/deploy.sh <git-ref>  # or a specific commit/tag
```

The script builds the new version alongside the running one, installs the sudoers rules it needs, swaps it in, and smoke-tests it (login, auth, CSRF, read, validate, and a no-op save). If any check fails it restores the previous version and sudoers automatically. It never edits or reloads Caddy. The previous version is kept at `/opt/caddy-ui.prev`.

Upgrading from 1.0.x (no `scripts/` yet)? Fetch the script once:

```bash
curl -fsSL https://raw.githubusercontent.com/JohnnyRacket/Simple-Caddy-UI/main/scripts/deploy.sh -o /tmp/deploy.sh
sudo bash /tmp/deploy.sh
```

---

## Safe saves

Every save, from the editor or an agent, goes through one path:

1. **Version check** — the save carries the ETag of the version it was based on; if the file changed since (another tab, an agent), it is refused rather than overwriting.
2. **Validate the new text** with `caddy validate`, before anything is written.
3. **Snapshot** the current file into the change history (`/var/lib/caddy-ui/history`, last 50).
4. **Write, reload**, and read Caddy's running config back through its admin API to confirm the reload took effect.
5. **Health check** — every site the change didn't touch is requested before and after; if one starts answering differently, or the reload fails, the previous Caddyfile is restored and reloaded.

The **Changes** page shows the history with diffs, and can restore the version before any change.

## MCP server (AI agents)

`/api/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io/) endpoint (Streamable HTTP). An agent can read and validate the Caddyfile, list sites, check whether a domain is ready, and **propose** changes. Nothing is applied until you approve it.

### Connect an agent

1. In the UI, open **MCP tokens** and create a token. `read` tokens can read, list, validate, read logs and check domains; `write` tokens can also propose and apply changes.
2. Put the token in the environment of the agent host (for example `CADDY_MCP_TOKEN`), and add the server. For OpenCode / OpenChamber (`~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "mcp": {
    "servers": {
      "caddy": {
        "type": "remote",
        "url": "http://caddy.localdomain:3000/api/mcp",
        "oauth": false,
        "protocol": "auto",
        "headers": { "Authorization": "Bearer {env:CADDY_MCP_TOKEN}" }
      }
    }
  }
}
```

`"protocol": "auto"` matters: the in-chat approval form needs the 2026-07-28 protocol. Clients on the older protocol still work; they approve on the Changes page instead.

### Tools

| Tool | Scope | |
|---|---|---|
| `read` | read | Caddyfile text and ETag |
| `list_sites` | read | Every host: handler and upstream, behind auth, rate limited, managed by MCP |
| `format`, `validate` | read | `caddy fmt` / `caddy validate` on given text; nothing is written |
| `logs` | read | Recent Caddy log entries (request headers stripped) |
| `history` | read | Recent changes and their outcomes |
| `check_domain` | read | DNS points at this box, a valid certificate is served, what HTTPS answers |
| `propose_change` | write | A whole new Caddyfile (needs the ETag from `read`) |
| `propose_site` / `propose_remove_site` | write | One site from a template (`dokploy` → `import dokploy_proxy`, or `reverse_proxy` to an upstream; optional `rate_limit`, `auth`), kept between `# caddy-mcp:begin/end <host>` markers |
| `propose_rollback` | write | Restore the version before a history entry |
| `apply` | write | Apply a proposal once you approve it |

### Approval

Each write token has an approval mode, set on the **MCP tokens** page:

- **Approval form / Changes page** (default) — `apply` asks you through the client's MCP approval form, or you approve on the **Changes** page.
- **Client's permission prompt** — for clients whose approval form doesn't work, such as OpenChamber running Claude Code (its answer can't be submitted there). Add an `ask` rule so the client prompts before every apply, and always choose **Allow once**; **Allow always** would switch approval off:

```jsonc
"permissions": [{ "action": "caddy_apply", "resource": "*", "effect": "ask" }]
```

A proposal is validated and stored with its diff and **risk flags**: removed sites, edits to the global options (including the auth portal config) or to shared snippets, sites behind auth or listed in `CADDY_SENSITIVE_HOSTS`, dropped rate limits, and large diffs. When the agent calls `apply`, the server asks you through an approval form in the chat client, or you approve on the **Changes** page. Only the exact proposed text is applied, through the safe-save path above.

Agent-submitted text may only `import` snippets or files under the Caddyfile's directory, and may not bind Caddy's admin port or change the `admin` option.

### Settings (`.env.local`)

| Variable | Default | |
|---|---|---|
| `CADDY_UI_DATA_DIR` | `/var/lib/caddy-ui` | Tokens, proposals, history |
| `CADDY_MCP_APPROVAL` | `chat` | `ui` accepts approvals only from the Changes page (needs your UI login), never from the chat form |
| `CADDY_SENSITIVE_HOSTS` | | Comma-separated hosts to always flag, e.g. `vaultwarden.example.com` |
| `CADDY_PUBLIC_IPS` | auto | The box's public IPs for `check_domain`; by default the address most configured sites resolve to |
| `PUBLIC_URL` | request host | Base URL used in approval links |
| `CADDY_ADMIN_URL` | `http://127.0.0.1:2019` | Caddy's admin API, used to confirm reloads |

## Security & Threat Model

caddy-ui is designed for **LAN/trusted-network use only**.

- **Do not expose port 3000 to the public internet.** The app has no brute-force protection beyond the built-in rate limiter, and a compromised token grants full Caddyfile write access.
- **What MCP approval does and doesn't protect against.** Approval stops an agent from changing the live config without your review, and every change is validated, health-checked and recorded. With `CADDY_MCP_APPROVAL=chat` the approval answer comes back through the MCP client, so an agent determined to bypass it could send that answer itself with the token; `CADDY_MCP_APPROVAL=ui` closes that by accepting approvals only from the UI. Neither helps against an agent that has other access to the box, such as a shell there — and note that Caddy's admin API on `localhost:2019` accepts config changes from any local user.
- **Auth is a single shared secret.** `SECRET_TOKEN` is a bearer token, not a user account system. Treat it like a password and rotate it if exposed.
- **The app runs with limited `sudo` access.** Only the specific commands in the sudoers file are allowed — it cannot run arbitrary commands as root.
- **LAN enforcement is enabled by default, but is not a security boundary.** `LOCAL_ONLY=true` blocks requests whose IP doesn't match a known private range, but this check runs in application middleware — it can be fooled by misconfigured proxies, spoofed headers, or future code changes. It is a convenience guard for accidental exposure, not a hardened firewall rule. **Do not rely on it as your only protection.** If you need to restrict access, do it at the network level (firewall, VPN, or reverse proxy with proper IP allowlisting).

The install paths and usernames used in this README (`/opt/caddy-ui`, `caddy-ui` user) are conventions, not requirements. Adapt them to your environment as needed.
