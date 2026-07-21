#!/usr/bin/env bash
# End-to-end smoke test for tenant + flag CRUD, audit history, and isolation.
set -euo pipefail

BASE="http://localhost:${PORT:-3010}/api/v1"
SUFFIX="$(date +%s)"

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

echo "== register tenant A and B =="
A_RESPONSE=$(curl -fsS -X POST "$BASE/tenants" -H 'Content-Type: application/json' -d "{\"name\":\"Tenant A $SUFFIX\"}")
B_RESPONSE=$(curl -fsS -X POST "$BASE/tenants" -H 'Content-Type: application/json' -d "{\"name\":\"Tenant B $SUFFIX\"}")
A_ID=$(echo "$A_RESPONSE" | json "['tenant']['id']")
A_KEY=$(echo "$A_RESPONSE" | json "['apiKey']")
B_KEY=$(echo "$B_RESPONSE" | json "['apiKey']")
echo "tenant A: $A_ID"

echo "== create flag as tenant A (expect 201) =="
curl -fsS -X POST "$BASE/tenants/$A_ID/flags" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"key":"new-checkout","description":"New checkout flow","type":"boolean","defaultValue":false}' \
  | json "['key']"

echo "== duplicate flag key (expect 409) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/tenants/$A_ID/flags" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"key":"new-checkout","type":"boolean","defaultValue":false}')
[ "$CODE" = "409" ] && echo "409 OK" || { echo "FAIL: got $CODE"; exit 1; }

echo "== mismatched default value type (expect 400) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/tenants/$A_ID/flags" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"key":"bad-flag","type":"number","defaultValue":"ten"}')
[ "$CODE" = "400" ] && echo "400 OK" || { echo "FAIL: got $CODE"; exit 1; }

echo "== toggle flag on in production with 25% rollout =="
curl -fsS -X PUT "$BASE/tenants/$A_ID/flags/new-checkout" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"environment":"production","enabled":true,"rolloutPercentage":25}' \
  | json "['environments']['production']"

echo "== list flags filtered to production =="
curl -fsS "$BASE/tenants/$A_ID/flags?environment=production&status=active" \
  -H "Authorization: Bearer $A_KEY" | json "[0]['environments']"

echo "== flag history (expect created + updated) =="
curl -fsS "$BASE/tenants/$A_ID/flags/new-checkout/history" \
  -H "Authorization: Bearer $A_KEY" | json " and [e['action'] for e in d]"

echo "== tenant B cannot access tenant A flags (expect 403) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/tenants/$A_ID/flags" -H "Authorization: Bearer $B_KEY")
[ "$CODE" = "403" ] && echo "403 OK" || { echo "FAIL: got $CODE"; exit 1; }

echo "== no API key (expect 401) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/tenants/$A_ID/flags")
[ "$CODE" = "401" ] && echo "401 OK" || { echo "FAIL: got $CODE"; exit 1; }

echo "== archive flag (soft delete) =="
curl -fsS -X DELETE "$BASE/tenants/$A_ID/flags/new-checkout" \
  -H "Authorization: Bearer $A_KEY" | json "['status']"

echo "== archived flag still listable via status filter =="
curl -fsS "$BASE/tenants/$A_ID/flags?status=archived" \
  -H "Authorization: Bearer $A_KEY" | json "[0]['status']"

echo "== update after archive (expect 404) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/tenants/$A_ID/flags/new-checkout" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"defaultValue":true}')
[ "$CODE" = "404" ] && echo "404 OK" || { echo "FAIL: got $CODE"; exit 1; }

echo "ALL SMOKE CHECKS PASSED"
