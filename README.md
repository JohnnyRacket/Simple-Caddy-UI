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

### 2. Clone & Build

```bash
cd ~
git clone https://github.com/JohnnyRacket/Simple-Caddy-UI.git caddy-ui
cd caddy-ui

npm install

# Create env file — adjust path if your Caddyfile is elsewhere
echo "CADDYFILE_PATH=/etc/caddy/Caddyfile" > .env.local

npm run build
```

### 3. Configure Sudoers

The app needs passwordless `sudo` for a few specific commands. Replace `YOUR_USER` with the user that will run the app (e.g. `pi`, `caddy`).

```bash
sudo visudo -f /etc/sudoers.d/caddy-ui
```

Paste the following, then save and exit:

```
YOUR_USER ALL=(ALL) NOPASSWD: /bin/cp /tmp/* /etc/caddy/Caddyfile
YOUR_USER ALL=(ALL) NOPASSWD: /bin/systemctl reload caddy
YOUR_USER ALL=(ALL) NOPASSWD: /usr/bin/caddy validate --config /etc/caddy/Caddyfile
```

Verify it works:

```bash
sudo /bin/systemctl reload caddy
```

### 4. Create a Systemd Service

This keeps the app running and restarts it on failure.

```bash
sudo nano /etc/systemd/system/caddy-ui.service
```

Paste the following, replacing `YOUR_USER` and the path if you cloned elsewhere:

```ini
[Unit]
Description=Caddy UI
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/home/caddy/caddy-ui
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

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
