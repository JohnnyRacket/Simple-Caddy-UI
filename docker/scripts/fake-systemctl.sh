#!/bin/bash
# Fake systemctl stub for the Caddy UI test environment.
# Only handles the commands the app uses.
case "$*" in
  "reload caddy") exec /usr/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile ;;
  "is-active --quiet caddy"|"is-active caddy") exec pgrep -f "caddy run" >/dev/null ;;
  *) echo "systemctl: '$*' not supported in test container" >&2; exit 1 ;;
esac
