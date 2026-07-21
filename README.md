# Multi-Tenant Feature Flag Service

A production-oriented feature flag and runtime configuration service built for
the Contrarian Thinking Backend & Platform take-home assessment.

## Current status

Phases 1–3 establish the NestJS application, PostgreSQL/Prisma data model,
Redis connection, structured request logging, correlation IDs, health checks,
tenant registration with hashed API keys, tenant-scoped authentication guards,
per-tenant rate limiting, and full feature flag CRUD with environment-scoped
configs, soft-delete (archive), and an immutable audit trail. Flag evaluation,
infrastructure, and deployment are implemented in subsequent phases.

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

### Rate limiting

Authenticated requests are limited per tenant (default 300 requests/minute,
configurable via `RATE_LIMIT_PER_MINUTE`) using a fixed one-minute Redis
window. Exceeding the limit returns `429 Too Many Requests` with a
`Retry-After` header.

## Quality checks

```bash
npm run lint
npm test
npm run build
```

## Architecture

The application is organized by domain module. PostgreSQL is the source of
truth, Redis supports low-latency evaluation caching and tenant rate limiting,
and all incoming requests receive an `x-correlation-id` included in structured
JSON logs.

Detailed API documentation, evaluation algorithm, GCP architecture, deployment
strategy, test results, assumptions, and trade-offs will be added as their
implementation phases are completed.
