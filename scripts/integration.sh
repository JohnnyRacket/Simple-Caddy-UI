#!/usr/bin/env bash
# Integration tests against real Caddy in the Docker test image.
# Runs a copy of the working tree (so the container's Linux npm install leaves
# your node_modules alone), then tests/integration from this machine.
#   ./scripts/integration.sh          # dev server (next dev)
#   MODE=production ./scripts/integration.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=${CONTAINER:-cui-int}
PORT=${PORT:-3100}
MODE=${MODE:-development}
SRC=$(mktemp -d /tmp/caddy-ui-int.XXXXXX)
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$SRC"; }
[[ ${KEEP:-} == 1 ]] || trap cleanup EXIT

rsync -a --exclude node_modules --exclude .next --exclude .git ./ "$SRC/"
docker build -q -f docker/Dockerfile -t caddy-ui-test . >/dev/null
docker rm -f "$NAME" >/dev/null 2>&1 || true
# :3000 is the image's dev server; production mode adds a build on :3001 next to it
docker run -d --name "$NAME" -p "$PORT:3000" -p "$((PORT + 1)):3001" -v "$SRC:/app" -e SECRET_TOKEN=password caddy-ui-test >/dev/null

if [[ $MODE == production ]]; then
  # Wait for the entrypoint's npm install, then build and start alongside the dev server
  until docker exec "$NAME" test -f /app/node_modules/.package-lock.json 2>/dev/null; do sleep 2; done
  sleep 5
  docker exec "$NAME" bash -c 'cd /app && sudo -u caddy-ui env HOME=/tmp npm run build >/tmp/build.log 2>&1 || { tail -30 /tmp/build.log; exit 1; }'
  docker exec -d "$NAME" bash -c 'cd /app && sudo -u caddy-ui env SECRET_TOKEN=password CADDYFILE_PATH=/etc/caddy/Caddyfile PORT=3001 npm start >/tmp/prod.log 2>&1'
  PORT=$((PORT + 1))
fi

echo "waiting for $MODE server on :$PORT ..."
for _ in $(seq 180); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 2; done
CADDY_UI_URL="http://localhost:$PORT" CONTAINER="$NAME" SECRET_TOKEN=password \
  npx vitest run --config vitest.integration.config.mts "$@"
