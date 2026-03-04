FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

# Install Caddy (official apt repo), Node.js 20, sudo, supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl gnupg ca-certificates debian-keyring \
        debian-archive-keyring apt-transport-https \
        sudo supervisor \
    # Caddy apt repo
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
       | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
    && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
       | tee /etc/apt/sources.list.d/caddy-stable.list \
    && apt-get update && apt-get install -y caddy \
    # Node.js 20
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create appuser + sudoers matching the Pi rules
RUN useradd -m -s /bin/bash appuser \
    && echo 'appuser ALL=(ALL) NOPASSWD: /bin/cp * /etc/caddy/Caddyfile, /usr/bin/caddy validate --config /etc/caddy/Caddyfile, /usr/bin/systemctl reload caddy' \
       > /etc/sudoers.d/caddy-ui \
    && chmod 0440 /etc/sudoers.d/caddy-ui

# Caddy log directory
RUN mkdir -p /var/log/caddy && touch /var/log/caddy/caddy.log \
    && chown appuser:appuser /var/log/caddy/caddy.log

# Initial Caddyfile (world-readable so appuser can read without sudo)
COPY docker/Caddyfile /etc/caddy/Caddyfile
RUN chmod 644 /etc/caddy/Caddyfile

# Fake systemctl — placed at /usr/bin/systemctl (= /bin/systemctl on Ubuntu 22.04)
# Real systemd is absent, so this path is free
COPY docker/scripts/fake-systemctl.sh /usr/bin/systemctl
RUN chmod +x /usr/bin/systemctl

# Fake journalctl — /usr/local/bin takes priority in PATH
COPY docker/scripts/fake-journalctl.sh /usr/local/bin/journalctl
RUN chmod +x /usr/local/bin/journalctl

# supervisord config
COPY docker/supervisord.conf /etc/supervisor/conf.d/caddy-ui.conf

COPY docker/scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app
EXPOSE 3000 80
ENTRYPOINT ["/entrypoint.sh"]
