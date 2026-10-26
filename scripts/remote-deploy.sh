#!/usr/bin/env bash
# Deploy a pushed commit to the caddy-ui server over SSH, using that commit's
# own scripts/deploy.sh (a few seconds of UI downtime; Caddy isn't touched).
#
#   scripts/remote-deploy.sh            # the current commit
#   scripts/remote-deploy.sh <git-ref>  # a specific commit/tag
#
# Env overrides: DEPLOY_HOST (default caddy@caddy.localdomain), SKIP_TESTS=1
set -Eeuo pipefail

HOST=${DEPLOY_HOST:-caddy@caddy.localdomain}
REF=${1:-HEAD}
REMOTE_SCRIPT=/tmp/caddy-ui-deploy.sh

die() { printf '!!! %s\n' "$*" >&2; exit 1; }
cd "$(git rev-parse --show-toplevel)"

SHA=$(git rev-parse --verify "$REF^{commit}" 2>/dev/null) || die "unknown ref $REF"
if [[ $REF == HEAD && -n $(git status --porcelain) ]]; then
  die "uncommitted changes; commit and push them first (the server builds from GitHub)"
fi

# The server clones from GitHub, so the commit has to be there
git fetch -q origin
[[ -n $(git branch -r --contains "$SHA" 2>/dev/null) ]] || die "${SHA:0:7} is not on origin; push it first"

if [[ ${SKIP_TESTS:-} != 1 ]]; then
  printf '==> Tests at %s\n' "${SHA:0:7}"
  if [[ $SHA == $(git rev-parse HEAD) ]]; then
    npm test --silent
  else
    echo "    skipped: ${SHA:0:7} is not checked out"
  fi
fi

printf '==> Deploying %s to %s\n' "${SHA:0:7}" "$HOST"
git show "$SHA:scripts/deploy.sh" | ssh "$HOST" "cat > $REMOTE_SCRIPT"
ssh -t "$HOST" "sudo bash $REMOTE_SCRIPT $SHA; rc=\$?; rm -f $REMOTE_SCRIPT; exit \$rc"
