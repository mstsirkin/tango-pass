#!/usr/bin/env bash
set -euo pipefail

API_BASE=${API_BASE:-""}
ADMIN_TOKEN=${ADMIN_TOKEN:-""}

if [ -z "$API_BASE" ] || [ -z "$ADMIN_TOKEN" ]; then
  echo "Usage: API_BASE=... ADMIN_TOKEN=... $0" >&2
  exit 1
fi

now_iso=$(python3 - <<'PY'
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace('+00:00','Z'))
PY
)

student_json=$(curl -sS -X POST "$API_BASE/admin/addStudent" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"name":"Smoke Test"}')

student_id=$(python3 - <<'PY'
import json,sys
print(json.loads(sys.stdin.read())['student']['id'])
PY
<<<"$student_json")

student_token=$(python3 - <<'PY'
import json,sys
print(json.loads(sys.stdin.read())['student']['token'])
PY
<<<"$student_json")

echo "Student: id=$student_id token=$student_token"

curl -sS -X POST "$API_BASE/admin/setNextLesson" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d "{\"starts_at\":\"$now_iso\"}" >/dev/null

curl -sS -X POST "$API_BASE/admin/addPurchase" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d "{\"student_id\":$student_id,\"credits_total\":10,\"validity_months\":1}" >/dev/null

curl -sS -X POST "$API_BASE/register?t=$student_token" >/dev/null
curl -sS -X POST "$API_BASE/cancel?t=$student_token" >/dev/null

backup=$(curl -sS -X POST "$API_BASE/admin/exportLedger" \
  -H "X-Admin-Token: $ADMIN_TOKEN")

echo "Backup: $backup"

status=$(curl -sS "$API_BASE/admin/backupStatus" -H "X-Admin-Token: $ADMIN_TOKEN")

echo "Backup status: $status"

status_student=$(curl -sS "$API_BASE/status?t=$student_token")

echo "Student status: $status_student"

echo "Smoke test complete."
