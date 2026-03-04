#!/bin/bash
set -e

# Install node_modules on first run (bind-mount volume scenario)
if [ ! -d /app/node_modules/.bin ]; then
    echo "[entrypoint] Installing Node.js dependencies..."
    cd /app && npm install
fi

# Ensure appuser can write to node_modules (needed by next dev build cache)
chown -R appuser:appuser /app/node_modules /app/.next 2>/dev/null || true

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
