# Simple Caddy UI

A Next.js management UI for [Caddy](https://caddyserver.com/) — edit your Caddyfile, validate, format, reload, and tail logs from a browser.

---

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

> **`LOCAL_ONLY`** — by default the app rejects requests from non-LAN IPs. If you're running behind a reverse proxy or need to adjust this, add `LOCAL_ONLY=false` to your `.env.local`.

### 4. Configure Sudoers

The app needs passwordless `sudo` for a few specific commands.

```bash
sudo visudo -f /etc/sudoers.d/caddy-ui
```

Paste the following, then save and exit:

```
caddy-ui ALL=(ALL) NOPASSWD: /bin/cp /tmp/caddyfile-* /etc/caddy/Caddyfile
caddy-ui ALL=(ALL) NOPASSWD: /bin/systemctl reload caddy
caddy-ui ALL=(ALL) NOPASSWD: /usr/bin/caddy validate --config /etc/caddy/Caddyfile
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

Next.js automatically loads `.env.local` at startup, so no extra environment configuration is needed in the service file.

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
sudo -u caddy-ui git -C /opt/caddy-ui pull
sudo -u caddy-ui npm --prefix /opt/caddy-ui install
sudo -u caddy-ui npm --prefix /opt/caddy-ui run build
sudo systemctl restart caddy-ui
```

---

# I think this goes without saying but do not expose this to the public internet directly.
