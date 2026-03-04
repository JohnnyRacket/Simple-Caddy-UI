#!/bin/bash
set -e

# Sync node_modules with package.json on every start
echo "[entrypoint] Syncing Node.js dependencies..."
cd /app && npm install

# Ensure appuser can write to node_modules (needed by next dev build cache)
chown -R appuser:appuser /app/node_modules /app/.next 2>/dev/null || true

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
