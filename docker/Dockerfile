FROM ubuntu:22.04@sha256:3ba65aa20f86a0fad9df2b2c259c613df006b2e6d0bfcc8a146afb8c525a9751
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
    # Node.js 24
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create caddy-ui service user + sudoers matching the Pi rules
RUN useradd --system --no-create-home --shell /usr/sbin/nologin caddy-ui \
    && echo 'caddy-ui ALL=(ALL) NOPASSWD: /bin/cp /tmp/caddyfile-*/Caddyfile /etc/caddy/Caddyfile' > /etc/sudoers.d/caddy-ui \
    && echo 'caddy-ui ALL=(ALL) NOPASSWD: /usr/bin/caddy validate --config /etc/caddy/Caddyfile' >> /etc/sudoers.d/caddy-ui \
    && echo 'caddy-ui ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload caddy' >> /etc/sudoers.d/caddy-ui \
    && echo 'caddy-ui ALL=(ALL) NOPASSWD: /usr/bin/journalctl -u caddy -f --no-pager -o short-iso' >> /etc/sudoers.d/caddy-ui \
    && chmod 0440 /etc/sudoers.d/caddy-ui

# Caddy log directory
RUN mkdir -p /var/log/caddy && touch /var/log/caddy/caddy.log \
    && chown caddy-ui:caddy-ui /var/log/caddy/caddy.log

# Initial Caddyfile (world-readable so appuser can read without sudo)
COPY docker/Caddyfile /etc/caddy/Caddyfile
RUN chmod 644 /etc/caddy/Caddyfile

# Fake systemctl — placed at /usr/bin/systemctl (= /bin/systemctl on Ubuntu 22.04)
# Real systemd is absent, so this path is free
COPY docker/scripts/fake-systemctl.sh /usr/bin/systemctl
RUN chmod +x /usr/bin/systemctl

# Fake journalctl at /usr/bin/journalctl (no real systemd in container, path is free)
COPY docker/scripts/fake-journalctl.sh /usr/bin/journalctl
RUN chmod +x /usr/bin/journalctl

# supervisord config
COPY docker/supervisord.conf /etc/supervisor/conf.d/caddy-ui.conf

COPY docker/scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app
EXPOSE 3000 80
ENTRYPOINT ["/entrypoint.sh"]
