#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT_DIR"

if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler is required" >&2
  exit 1
fi

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "Set ADMIN_TOKEN in the environment before running." >&2
  exit 1
fi

if rg -q "REPLACE_ME_TEST" wrangler.toml; then
  echo "Looking for existing testing D1 database..."
  EXISTING_ID=$(wrangler d1 list --json | python3 - <<'PY'
import json, sys
data = json.load(sys.stdin)
for db in data:
    if db.get("name") == "tango-pass-test":
        print(db.get("uuid", ""))
        break
PY
  )

  if [ -z "$EXISTING_ID" ]; then
    echo "Creating D1 database for testing..."
    CREATE_OUTPUT=$(wrangler d1 create tango-pass-test --binding DB --env testing 2>&1)
    printf "%s\n" "$CREATE_OUTPUT"
    EXISTING_ID=$(printf "%s" "$CREATE_OUTPUT" | rg -o "database_id = \\\"[^\"]+\\\"" | head -n 1 | rg -o "[0-9a-fA-F-]+")
  fi

  if [ -z "$EXISTING_ID" ]; then
    echo "Failed to resolve testing D1 database id." >&2
    exit 1
  fi

  python3 - "$EXISTING_ID" <<'PY'
import sys
path = "wrangler.toml"
db_id = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = f.read()
data = data.replace('database_id = "REPLACE_ME_TEST"', f'database_id = "{db_id}"')
with open(path, "w", encoding="utf-8") as f:
    f.write(data)
PY
fi

wrangler d1 migrations apply tango-pass-test --remote --env testing

printf "%s" "$ADMIN_TOKEN" | wrangler secret put ADMIN_TOKEN --env testing

echo "Ensuring R2 backup bucket exists..."
if ! wrangler r2 bucket create tango-pass-ledger-backups-test >/tmp/r2-create.log 2>&1; then
  if rg -q "enable R2" /tmp/r2-create.log; then
    cat /tmp/r2-create.log >&2
    echo "Enable R2 in the Cloudflare dashboard, then rerun deploy-test.sh." >&2
    exit 1
  fi
  if ! rg -q "already exists" /tmp/r2-create.log; then
    cat /tmp/r2-create.log >&2
    exit 1
  fi
fi

echo "Deploying Worker to testing..."
DEPLOY_OUTPUT=$(wrangler deploy --env testing 2>&1)
printf "%s\n" "$DEPLOY_OUTPUT"

WORKER_URL=$(printf "%s" "$DEPLOY_OUTPUT" | rg -o "https://[^ ]+\\.workers\\.dev" | head -n 1 || true)
if [ -z "$WORKER_URL" ] && [ -n "${TEST_WORKER_URL:-}" ]; then
  WORKER_URL="$TEST_WORKER_URL"
fi

if [ -n "$WORKER_URL" ]; then
  cat > public/config.js <<CONFIG
window.APP_CONFIG = {
  apiBase: "${WORKER_URL}"
};
CONFIG
else
  echo "Warning: could not detect worker URL. Pass TEST_WORKER_URL to set public/config.js." >&2
fi

wrangler pages project create solotango-test --production-branch main >/dev/null 2>&1 || true

wrangler pages deploy public --project-name solotango-test --branch main

echo "Testing deployment complete: https://solotango-test.pages.dev"
