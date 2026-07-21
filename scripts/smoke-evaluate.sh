#!/usr/bin/env bash
# End-to-end smoke test for flag evaluation: determinism, rollout, targeting,
# caching, tenant isolation, and metrics exposure.
set -euo pipefail

BASE="http://localhost:${PORT:-3010}/api/v1"
SUFFIX="$(date +%s)"

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d$1)"; }

echo "== register tenants =="
A_RESPONSE=$(curl -fsS -X POST "$BASE/tenants" -H 'Content-Type: application/json' -d "{\"name\":\"Eval A $SUFFIX\"}")
B_RESPONSE=$(curl -fsS -X POST "$BASE/tenants" -H 'Content-Type: application/json' -d "{\"name\":\"Eval B $SUFFIX\"}")
A_ID=$(echo "$A_RESPONSE" | json "['tenant']['id']")
A_KEY=$(echo "$A_RESPONSE" | json "['apiKey']")
B_KEY=$(echo "$B_RESPONSE" | json "['apiKey']")

echo "== create flags: boolean at 50% and string variant with targeting =="
curl -fsS -X POST "$BASE/tenants/$A_ID/flags" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"key":"new-checkout","type":"boolean","defaultValue":false}' > /dev/null
curl -fsS -X PUT "$BASE/tenants/$A_ID/flags/new-checkout" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"environment":"production","enabled":true,"rolloutPercentage":50}' > /dev/null

curl -fsS -X POST "$BASE/tenants/$A_ID/flags" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"key":"banner-text","type":"string","defaultValue":"control"}' > /dev/null
curl -fsS -X PUT "$BASE/tenants/$A_ID/flags/banner-text" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"environment":"production","enabled":true,"rolloutPercentage":0,"variantValue":"variant-a","targetingRules":[{"attribute":"country","values":["US"]}]}' > /dev/null

evaluate() {
  curl -fsS -X POST "$BASE/evaluate" \
    -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
    -d "{\"tenant_id\":\"$A_ID\",\"environment\":\"production\",\"user_id\":\"$1\",\"flag_key\":\"$2\",\"context\":$3}"
}

echo "== determinism: same user evaluated 5x must be identical =="
FIRST=$(evaluate "user-42" "new-checkout" '{}')
for i in 1 2 3 4 5; do
  NEXT=$(evaluate "user-42" "new-checkout" '{}')
  [ "$FIRST" = "$NEXT" ] || { echo "FAIL: non-deterministic: $FIRST vs $NEXT"; exit 1; }
done
echo "deterministic OK: $FIRST"

echo "== 50% rollout splits a user population =="
ON=0; OFF=0
for i in $(seq 1 40); do
  VALUE=$(evaluate "load-user-$i" "new-checkout" '{}' | json "['value']")
  if [ "$VALUE" = "True" ]; then ON=$((ON+1)); else OFF=$((OFF+1)); fi
done
echo "on=$ON off=$OFF"
[ "$ON" -gt 5 ] && [ "$OFF" -gt 5 ] || { echo "FAIL: split looks degenerate"; exit 1; }

echo "== targeting rule beats 0% rollout =="
MATCH=$(evaluate "user-1" "banner-text" '{"country":"US"}')
echo "$MATCH"
[ "$(echo "$MATCH" | json "['value']")" = "variant-a" ] || { echo "FAIL"; exit 1; }
[ "$(echo "$MATCH" | json "['reason']")" = "targeting_match" ] || { echo "FAIL"; exit 1; }
NOMATCH=$(evaluate "user-1" "banner-text" '{"country":"DE"}')
[ "$(echo "$NOMATCH" | json "['value']")" = "control" ] || { echo "FAIL: $NOMATCH"; exit 1; }
echo "targeting OK"

echo "== bulk evaluation returns all active flags =="
BULK=$(curl -fsS -X POST "$BASE/evaluate/bulk" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d "{\"tenant_id\":\"$A_ID\",\"environment\":\"production\",\"user_id\":\"user-42\",\"context\":{\"country\":\"US\"}}")
echo "$BULK"
echo "$BULK" | json "['flags']['new-checkout']" > /dev/null
echo "$BULK" | json "['flags']['banner-text']" > /dev/null

echo "== tenant B key cannot evaluate tenant A flags (expect 403) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/evaluate" \
  -H "Authorization: Bearer $B_KEY" -H 'Content-Type: application/json' \
  -d "{\"tenant_id\":\"$A_ID\",\"environment\":\"production\",\"user_id\":\"u\",\"flag_key\":\"new-checkout\"}")
[ "$CODE" = "403" ] && echo "403 OK" || { echo "FAIL: got $CODE"; exit 1; }

echo "== unknown flag (expect 404) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/evaluate" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d "{\"tenant_id\":\"$A_ID\",\"environment\":\"production\",\"user_id\":\"u\",\"flag_key\":\"nope\"}")
[ "$CODE" = "404" ] && echo "404 OK" || { echo "FAIL: got $CODE"; exit 1; }

echo "== cache invalidation: flip flag off, evaluation reflects it =="
curl -fsS -X PUT "$BASE/tenants/$A_ID/flags/new-checkout" \
  -H "Authorization: Bearer $A_KEY" -H 'Content-Type: application/json' \
  -d '{"environment":"production","enabled":false}' > /dev/null
AFTER=$(evaluate "user-42" "new-checkout" '{}')
[ "$(echo "$AFTER" | json "['reason']")" = "disabled" ] || { echo "FAIL: $AFTER"; exit 1; }
echo "invalidation OK: $AFTER"

echo "== metrics endpoint exposes evaluation counters =="
METRICS=$(curl -fsS "http://localhost:${PORT:-3010}/metrics")
echo "$METRICS" | grep -q 'flag_evaluations_total' || { echo "FAIL: no evaluation metric"; exit 1; }
echo "$METRICS" | grep -q 'flag_config_cache_events_total' || { echo "FAIL: no cache metric"; exit 1; }
echo "$METRICS" | grep -q 'http_requests_total' || { echo "FAIL: no http metric"; exit 1; }
echo "metrics OK"

echo "ALL EVALUATION SMOKE CHECKS PASSED"
