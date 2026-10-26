#!/usr/bin/env bash
# Update a self-hosted caddy-ui install with automatic rollback.
#
#   sudo bash /opt/caddy-ui/scripts/deploy.sh            # latest main from GitHub
#   sudo bash /opt/caddy-ui/scripts/deploy.sh <git-ref>  # a specific commit/tag
#
# Never touches Caddy itself: no Caddyfile changes, no reload. Only the UI
# service restarts (a few seconds of downtime).
#
#   1. Back up sudoers + Caddyfile to /root
#   2. Build the new version in /opt/caddy-ui.new while the live UI keeps running
#   3. Install the sudoers rules this version needs (visudo-checked)
#   4. Stop UI, swap directories, start UI
#   5. Smoke test; on any failure, swap back and restore sudoers automatically
#
# Env overrides: APP_DIR, REPO, URL (default http://localhost:$PORT, PORT from .env.local or 3000)
set -Eeuo pipefail

# Bash reads scripts lazily and this one moves its own directory, so run from a copy
if [[ ${CADDY_UI_DEPLOY_COPY:-} != 1 ]]; then
  copy=$(mktemp /tmp/caddy-ui-deploy.XXXXXX.sh)
  cp "$0" "$copy"
  CADDY_UI_DEPLOY_COPY=1 exec bash "$copy" "$@"
fi
trap 'rm -f "$0"' EXIT

REF=${1:-origin/main}
APP=${APP_DIR:-/opt/caddy-ui}
NEW=$APP.new
PREV=$APP.prev
REPO=${REPO:-https://github.com/JohnnyRacket/Simple-Caddy-UI.git}
SUDOERS=/etc/sudoers.d/caddy-ui
CADDYFILE=/etc/caddy/Caddyfile
BACKUP=/root/caddy-ui-backup-$(date +%Y%m%d-%H%M%S)

DATA_DIR=/var/lib/caddy-ui # MCP tokens, proposals, change history

SUDOERS_RULES='caddy-ui ALL=(root) NOPASSWD: /usr/bin/tee /etc/caddy/Caddyfile
caddy-ui ALL=(root) NOPASSWD: /bin/systemctl reload caddy
caddy-ui ALL=(caddy) NOPASSWD: /usr/bin/caddy validate --config - --adapter caddyfile
caddy-ui ALL=(root) NOPASSWD: /usr/bin/journalctl -u caddy -f --no-pager -o short-iso
caddy-ui ALL=(root) NOPASSWD: /usr/bin/journalctl -u caddy -n 500 --no-pager -o json'

step() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!!! %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run with sudo"
cd / # caddy-ui may not be able to read the caller's cwd
[[ ! -e $NEW ]] || die "$NEW exists from an earlier run; inspect and remove it first"
[[ -f $APP/.env.local ]] || die "$APP/.env.local missing"
grep -qE '^SECRET_TOKEN=.+' "$APP/.env.local" || die "SECRET_TOKEN not set in $APP/.env.local"
id caddy >/dev/null || die "user 'caddy' not found"

PORT=$(grep -E '^PORT=' "$APP/.env.local" | cut -d= -f2- || true)
URL=${URL:-http://localhost:${PORT:-3000}}
TOKEN=$(grep -E '^SECRET_TOKEN=' "$APP/.env.local" | head -1 | cut -d= -f2-)

WORK=$(mktemp -d /tmp/caddy-ui-work.XXXXXX) # caddy-ui has no home dir
chown caddy-ui:caddy-ui "$WORK"
trap 'rm -f "$0"; rm -rf "$WORK"' EXIT
as_app() { sudo -u caddy-ui env HOME="$WORK" NEXT_TELEMETRY_DISABLED=1 "$@"; }

install_sudoers() {
  local tmp; tmp=$(mktemp)
  printf '%s\n' "$1" > "$tmp"
  visudo -cqf "$tmp" || { rm -f "$tmp"; die "sudoers syntax check failed; left $SUDOERS unchanged"; }
  install -m 0440 -o root -g root "$tmp" "$SUDOERS"
  rm -f "$tmp"
}

expect() { # label, expected HTTP code, curl args...
  local label=$1 want=$2 got; shift 2
  got=$(curl -sS -o "$WORK/out" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$@" || echo 000)
  if [[ $got == "$want" ]]; then printf '    ok   %-30s %s\n' "$label" "$got"
  else printf '    FAIL %-30s got %s want %s\n' "$label" "$got" "$want"; head -c 400 "$WORK/out"; echo; return 1; fi
}
ok() { printf '    ok   %s\n' "$*"; }
fail() { printf '    FAIL %s\n' "$*"; false; }

# Each sudo rule the app relies on, exercised for real as caddy-ui
check_sudo_rules() {
  cp "$CADDYFILE" "$WORK/caddyfile"
  # Byte-identical write through the tee rule (from a copy: tee truncates its target first)
  sudo -u caddy-ui sudo -n /usr/bin/tee "$CADDYFILE" < "$WORK/caddyfile" > /dev/null || fail "sudo tee rule"
  [[ $(sha256sum "$CADDYFILE" | cut -d' ' -f1) == "$CADDYFILE_SHA" ]] || fail "Caddyfile changed!"
  ok "sudo tee rule (identical write, sha256 unchanged)"
  sudo -u caddy-ui sudo -n -u caddy /usr/bin/caddy validate --config - --adapter caddyfile < "$WORK/caddyfile" > /dev/null 2>&1 \
    || fail "sudo validate-from-stdin rule"
  ok "sudo validate rule (stdin, as caddy)"
  sudo -u caddy-ui sudo -n /usr/bin/journalctl -u caddy -n 500 --no-pager -o json > /dev/null || fail "sudo journalctl rule"
  ok "sudo journalctl rule"
}

# The app confirms each reload by reading Caddy's running config back; it must match caddy adapt
check_admin_readback() {
  (cd "$(dirname "$CADDYFILE")" && sudo -u caddy-ui env -i PATH=/usr/bin:/bin /usr/bin/caddy adapt --config - --adapter caddyfile < "$WORK/caddyfile" 2>/dev/null) > "$WORK/adapted.json"
  sudo -u caddy-ui env -i PATH=/usr/bin:/bin curl -s -m 5 http://127.0.0.1:2019/config/ > "$WORK/running.json"
  python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])) == json.load(open(sys.argv[2])) else 1)' "$WORK/adapted.json" "$WORK/running.json" \
    || fail "Caddy's running config does not match caddy adapt of the Caddyfile"
  ok "running config reads back and matches the Caddyfile"
}

# A real MCP round trip with a temporary read token
check_mcp() {
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/mcp")
  [[ $code == 401 ]] || fail "MCP without token got $code want 401"
  ok "MCP without token -> 401"
  curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -X POST -d '{"name":"deploy-smoke-'$$'","scope":"read"}' "$URL/api/tokens" > "$WORK/tok.json"
  local mcp_token token_id
  mcp_token=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$WORK/tok.json") || fail "could not create a token"
  token_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["record"]["id"])' "$WORK/tok.json")
  curl -s -H "Authorization: Bearer $mcp_token" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -H 'mcp-protocol-version: 2025-06-18' -X POST "$URL/api/mcp" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_sites","arguments":{}}}' > "$WORK/mcp.out"
  curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" -X DELETE "$URL/api/tokens/$token_id"
  grep -q '\\"sites\\"' "$WORK/mcp.out" || fail "MCP list_sites: $(head -c 300 "$WORK/mcp.out")"
  ok "MCP list_sites with a temporary token (revoked again)"
}

# Saving unchanged content through the app: validates, then reports no change
check_noop_save() {
  curl -s -H "Authorization: Bearer $TOKEN" "$URL/api/caddyfile" > "$WORK/read.json"
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"content": d["content"], "etag": d["etag"]}))' "$WORK/read.json" > "$WORK/save.json"
  expect "save (unchanged content)" 200 -X POST -H 'content-type: application/json' --data-binary @"$WORK/save.json" "$URL/api/caddyfile"
  grep -q '"outcome":"noop"' "$WORK/out" || fail "expected a no-op save: $(head -c 300 "$WORK/out")"
  [[ $(sha256sum "$CADDYFILE" | cut -d' ' -f1) == "$CADDYFILE_SHA" ]] || fail "Caddyfile changed!"
  ok "Caddyfile unchanged (sha256)"
}

step "Backing up to $BACKUP"
mkdir -m 700 "$BACKUP"
cp -a "$SUDOERS" "$BACKUP/sudoers"
cp -a "$CADDYFILE" "$BACKUP/Caddyfile"
CADDYFILE_SHA=$(sha256sum "$CADDYFILE" | cut -d' ' -f1)
OLD_SUDOERS=$(cat "$SUDOERS")
OLD_COMMIT=$(git -c safe.directory="$APP" -C "$APP" rev-parse --short HEAD 2>/dev/null || echo unknown)

step "Pre-check: caddy validate as the caddy user"
sudo -u caddy /usr/bin/caddy validate --config "$CADDYFILE" >/dev/null 2>&1 \
  || die "live Caddyfile does not validate as user caddy; aborting before any change"
echo "    ok"

step "Building $REF in $NEW (live UI untouched)"
install -d -o caddy-ui -g caddy-ui "$NEW"
as_app git -c safe.directory='*' clone -q "$REPO" "$NEW"
as_app git -C "$NEW" -c advice.detachedHead=false checkout -q --detach "$REF"
TARGET=$(as_app git -C "$NEW" rev-parse HEAD)
echo "    $OLD_COMMIT -> ${TARGET:0:7}"
install -m 600 -o caddy-ui -g caddy-ui "$APP/.env.local" "$NEW/.env.local"
(cd "$NEW" && as_app npm ci --no-audit --no-fund --loglevel=error)
(cd "$NEW" && as_app npm run build) | grep -E '✓|rror|arn' || true
[[ -f $NEW/.next/BUILD_ID ]] || die "build failed; live UI untouched, $NEW left for inspection"

# ---- From here on, failures roll back automatically ----
SWAPPED=0
rollback() {
  trap - ERR
  printf '\n!!! Step failed; rolling back\n' >&2
  systemctl stop caddy-ui || true
  if [[ $SWAPPED == 1 ]]; then
    rm -rf "$APP.failed"; mv "$APP" "$APP.failed"; mv "$PREV" "$APP"
    echo "    restored previous app; failed version kept at $APP.failed"
  fi
  install -m 0440 -o root -g root "$BACKUP/sudoers" "$SUDOERS" && echo "    restored sudoers"
  systemctl start caddy-ui && echo "    caddy-ui restarted on previous version"
  exit 1
}
trap rollback ERR

step "Data directory $DATA_DIR"
install -d -o caddy-ui -g caddy-ui -m 700 "$DATA_DIR"
echo "    ok"

step "Sudoers: new rules alongside the current ones"
install_sudoers "$OLD_SUDOERS
$SUDOERS_RULES"
echo "    ok"

step "Swapping in the new version"
[[ ! -e $PREV ]] || rm -rf "$PREV"
systemctl stop caddy-ui
mv "$APP" "$PREV"
mv "$NEW" "$APP"
SWAPPED=1
systemctl start caddy-ui

step "Smoke tests"
for _ in $(seq 60); do curl -s -o /dev/null "$URL/login" && break; sleep 1; done
expect "login page" 200 "$URL/login"
expect "health" 200 "$URL/api/health"
grep -q "\"commit\":\"$TARGET\"" "$WORK/out" || { echo "    FAIL serving commit is not ${TARGET:0:7}: $(cat "$WORK/out")"; false; }
echo "    ok   serving commit ${TARGET:0:7}"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer wrong' "$URL/api/caddyfile")
[[ $code == 401 ]] || { echo "    FAIL wrong token got $code want 401"; false; }
echo "    ok   wrong token -> 401"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: http://evil.example' -d token=x "$URL/api/auth/login")
[[ $code == 403 ]] || { echo "    FAIL cross-origin login got $code want 403"; false; }
echo "    ok   cross-origin POST -> 403"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $URL" -d "token=$TOKEN" "$URL/api/auth/login")
[[ $code == 303 ]] || { echo "    FAIL same-origin login got $code want 303"; false; }
echo "    ok   same-origin login -> 303"
expect "read Caddyfile" 200 "$URL/api/caddyfile"
expect "editor page" 200 "$URL/editor"
expect "validate (as caddy)" 200 -X POST "$URL/api/caddy/validate"
check_noop_save
check_mcp

step "Sudoers: exactly the rules this version needs"
install_sudoers "$SUDOERS_RULES"
check_sudo_rules
check_admin_readback

trap - ERR
chmod 600 "$APP/.env.local"

step "Done: ${TARGET:0:7} is live"
echo "    previous version ($OLD_COMMIT) kept at $PREV; backups in $BACKUP"
echo "    manual rollback: sudo systemctl stop caddy-ui && sudo mv $APP $APP.bad && sudo mv $PREV $APP \\"
echo "      && sudo install -m 0440 $BACKUP/sudoers $SUDOERS && sudo systemctl start caddy-ui"
