#!/bin/bash
# Fake systemctl stub for the Caddy UI test environment.
# Only handles the one command the app uses.
if [[ "$1" == "reload" && "$2" == "caddy" ]]; then
    /usr/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
else
    echo "systemctl: '$*' not supported in test container" >&2
    exit 1
fi
