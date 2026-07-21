# Multi-Tenant Feature Flag Service

A production-oriented feature flag and runtime configuration service built for
the Contrarian Thinking Backend & Platform take-home assessment.

## Current status

Phases 1–4 establish the NestJS application, PostgreSQL/Prisma data model,
Redis connection, structured request logging, correlation IDs, health checks,
tenant registration with hashed API keys, tenant-scoped authentication guards,
per-tenant rate limiting, full feature flag CRUD with environment-scoped
configs, soft-delete (archive), an immutable audit trail, and the deterministic
flag evaluation engine with Redis caching and Prometheus metrics.
Infrastructure and deployment are implemented in subsequent phases.

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- Docker with Docker Compose

## Local setup

```bash
nvm use
cp .env.example .env
docker compose up -d
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run start:dev
```

The API listens on `http://localhost:3000`.

## Health checks

- `GET /health/live` confirms the application process is running.
- `GET /health/ready` confirms PostgreSQL and Redis are reachable.

## API

All API routes are prefixed with `/api/v1`.

### Register a tenant

```bash
curl -X POST http://localhost:3000/api/v1/tenants \
  -H 'Content-Type: application/json' \
  -d '{"name": "Checkout App"}'
```

Response (`201 Created`):

```json
{
  "tenant": {
    "id": "3f6f6f6a-...",
    "name": "Checkout App",
    "slug": "checkout-app",
    "createdAt": "2026-07-21T14:35:25.706Z",
    "environments": [
      { "id": "...", "name": "development" },
      { "id": "...", "name": "staging" },
      { "id": "...", "name": "production" }
    ]
  },
  "apiKey": "ffk_XXXXXXXX_..."
}
```

The `apiKey` is returned exactly once and is never stored in plaintext; keep it
safe. A duplicate tenant name returns `409 Conflict`.

### Authentication

Tenant-scoped endpoints (added in later phases) require the API key as a
bearer token:

```
Authorization: Bearer ffk_XXXXXXXX_...
```

Keys are stored as SHA-256 hashes. Because API keys are high-entropy random
values (unlike passwords), a fast digest is appropriate and keeps per-request
verification cheap. Lookup uses an indexed key prefix and a constant-time hash
comparison. A key for one tenant cannot access another tenant's resources
(`403 Forbidden`).

### Feature flags

All flag endpoints require the tenant's API key and are scoped to
`/api/v1/tenants/{tenantId}/flags`. A key for another tenant receives
`403 Forbidden`; a missing key receives `401 Unauthorized`.

Create a flag (`201 Created`). A config is created for each of the tenant's
three environments, initially disabled with a 0% rollout:

```bash
curl -X POST "$BASE/tenants/$TENANT_ID/flags" \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"key":"new-checkout","description":"New checkout flow","type":"boolean","defaultValue":false}'
```

Flag types are `boolean`, `string`, and `number`; the `defaultValue` (and any
`variantValue`) must match the declared type or the request fails with `400`.
Duplicate keys within a tenant fail with `409`.

Update a flag (`200 OK`). `description` and `defaultValue` are flag-level;
`enabled`, `rolloutPercentage` (0–100), `targetingRules`, and `variantValue`
are environment-level and require `environment`:

```bash
curl -X PUT "$BASE/tenants/$TENANT_ID/flags/new-checkout" \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"environment":"production","enabled":true,"rolloutPercentage":25}'
```

Targeting rules are a list of context-attribute matches, e.g.
`[{"attribute":"country","values":["US","CA"]}]`.

List flags with optional filters (`200 OK`):

```bash
curl "$BASE/tenants/$TENANT_ID/flags?environment=production&status=active" \
  -H "Authorization: Bearer $API_KEY"
```

Archive (soft-delete) a flag (`200 OK`). Archived flags remain listable via
`status=archived` but can no longer be updated (`404`):

```bash
curl -X DELETE "$BASE/tenants/$TENANT_ID/flags/new-checkout" \
  -H "Authorization: Bearer $API_KEY"
```

### Audit history

Every create, update, and archive writes an append-only audit record in the
same database transaction as the change itself, capturing the actor (API key
prefix), the action, and full before/after snapshots. There are no update or
delete endpoints for audit records.

```bash
curl "$BASE/tenants/$TENANT_ID/flags/new-checkout/history" \
  -H "Authorization: Bearer $API_KEY"
```

Response entries are newest-first:

```json
[
  {
    "id": "…",
    "actor": "apikey:VJJd26vW",
    "action": "updated",
    "beforeValue": { "environments": { "production": { "enabled": false } } },
    "afterValue": { "environments": { "production": { "enabled": true } } },
    "createdAt": "2026-07-21T14:52:00.000Z"
  }
]
```

### Flag evaluation

Evaluate a single flag for a user (`200 OK`). The `tenant_id` in the body must
match the API key's tenant or the request fails with `403`:

```bash
curl -X POST "$BASE/evaluate" \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "'$TENANT_ID'",
    "environment": "production",
    "user_id": "user-123",
    "flag_key": "new-checkout",
    "context": { "country": "US" }
  }'
```

```json
{ "flag_key": "new-checkout", "value": true, "reason": "rollout" }
```

Bulk-evaluate all active flags for a user in one request:

```bash
curl -X POST "$BASE/evaluate/bulk" \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "'$TENANT_ID'",
    "environment": "production",
    "user_id": "user-123",
    "context": { "country": "US" }
  }'
```

```json
{
  "environment": "production",
  "user_id": "user-123",
  "flags": {
    "new-checkout": { "value": true, "reason": "rollout" },
    "banner-text": { "value": "variant-a", "reason": "targeting_match" }
  }
}
```

The spec leaves the single-evaluate body open; this implementation requires a
`flag_key` there and treats `/evaluate/bulk` as the way to fetch everything.

### How percentage rollouts work

Each `(flag_key, user_id)` pair is hashed with SHA-256 and the first 8 hex
characters are mapped to a bucket in `[0, 100)`:

```
bucket = parseInt(sha256("<flag_key>:<user_id>").slice(0, 8), 16) % 100
```

A user is in the rollout when `bucket < rolloutPercentage`. This gives three
properties that matter for gradual rollouts:

1. **Deterministic** — the same user always gets the same value for a flag; no
   state is stored per user.
2. **Monotonic** — raising the percentage only ever adds users; nobody who has
   the feature loses it (their bucket does not change).
3. **Independent per flag** — the flag key is part of the hash, so a user's
   position in one flag's rollout says nothing about their position in
   another's.

Evaluation order per flag: archived → serve default; disabled in the
environment → serve default; a targeting rule matches the context (e.g.
`context.country ∈ {US, CA}`) → serve the on-value, bypassing the rollout;
otherwise the rollout bucket decides. The on-value is `variantValue` when set,
`true` for boolean flags without one. Every response includes the `reason`
(`archived`, `disabled`, `targeting_match`, `rollout`, `not_in_rollout`).

### Caching strategy

Single-flag evaluation reads the flag's environment config through Redis
(`flagcfg:{tenant}:{env}:{flagKey}`, 5-minute TTL). Every flag mutation
deletes the affected keys in the same request, so evaluations reflect changes
immediately; the TTL only bounds staleness if an invalidation is ever missed.
Bulk evaluation queries PostgreSQL directly: it is a bootstrap operation for
client startup rather than a hot path, and caching per-tenant flag lists
would complicate invalidation for little gain. Evaluated results are not
cached; the hash is cheap and caching per-user results would multiply
cardinality.

### Metrics

`GET /metrics` (no auth, outside `/api/v1`) exposes Prometheus metrics:

- `flag_evaluation_duration_seconds` histogram (labels: `tenant`, `mode`) for
  p50/p95/p99 latency
- `flag_evaluations_total` counter (labels: `tenant`, `mode`)
- `flag_config_cache_events_total` counter (labels: `result` = `hit`/`miss`)
- `http_requests_total` counter (labels: `method`, `route`, `status`,
  `tenant`) for per-tenant/per-endpoint error rates
- Node.js runtime defaults (memory, event loop lag, GC)

### Rate limiting

Authenticated requests are limited per tenant (default 300 requests/minute,
configurable via `RATE_LIMIT_PER_MINUTE`) using a fixed one-minute Redis
window. Exceeding the limit returns `429 Too Many Requests` with a
`Retry-After` header.

## Quality checks

```bash
npm run lint
npm test                  # unit tests (no external dependencies)
npm run test:integration  # requires docker compose services
npm run build
```

## Testing strategy

Three layers, each testing what the layer below cannot:

- **Unit tests** (`test/unit/`, 63 tests) cover the pure logic where
  correctness matters most and mocking is cheap: the rollout hashing
  (determinism, 0–99 range, uniform distribution, per-flag independence,
  monotonicity as percentages increase), the evaluation engine's precedence
  rules (archived → disabled → targeting → rollout → default) for all three
  flag types, API key generation/hashing, guards, rate limiting, and the
  service-layer contracts (audit before/after snapshots, type validation,
  conflict/not-found handling, cache hit/miss paths).
- **Integration tests** (`test/integration/`, 11 tests) boot the full NestJS
  app against real PostgreSQL and Redis and verify what mocks would hide:
  tenant isolation end to end (tenant B's key gets 403 on tenant A's list,
  update, delete, and evaluate; flags never leak across list responses),
  environment scoping (a flag enabled in staging evaluates true there and
  `disabled` in production), and the audit trail (history accumulates across
  changes, and no write routes exist for it).
- **Load test** (`load/k6-evaluate.js`) exercises the evaluation hot path
  under concurrency — 90% single evaluations, 10% bulk.

With more time: contract tests for error response shapes, property-based
tests for the evaluation engine, a rate-limiting integration test with a
clock-controlled window, and soak tests for cache invalidation under
concurrent writes.

### Load test results

30-second run, 25 virtual users, local (MacBook Pro, API + PostgreSQL 17 +
Redis 8 in Docker, rate limit raised for the test):

| Metric | Result |
|--------|--------|
| Throughput | 1,447 req/s (43,803 requests, 0 failed) |
| `/evaluate` latency | avg 16.2ms, p90 23.4ms, p95 28.4ms |
| `/evaluate/bulk` latency | avg 23.2ms, p90 33.9ms, p95 41.9ms |
| Checks | 83,230 / 83,230 passed |

Run it yourself:

```bash
npm run start:prod &   # with RATE_LIMIT_PER_MINUTE=1000000
docker run --rm -i -e BASE_URL=http://host.docker.internal:3010 \
  grafana/k6 run - < load/k6-evaluate.js
```

## Architecture

The application is organized by domain module. PostgreSQL is the source of
truth, Redis supports low-latency evaluation caching and tenant rate limiting,
and all incoming requests receive an `x-correlation-id` included in structured
JSON logs.

Detailed API documentation, evaluation algorithm, GCP architecture, deployment
strategy, test results, assumptions, and trade-offs will be added as their
implementation phases are completed.
