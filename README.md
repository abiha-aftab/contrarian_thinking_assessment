# Multi-Tenant Feature Flag Service

Multi-tenant feature flag and runtime configuration API for the Contrarian
Thinking Backend & Platform take-home (Option C).

**Deployed URL:** _pending_

## Local setup

**Prerequisites:** Node.js 22 (`.nvmrc`), Docker Compose.

```bash
nvm use
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run start:dev
```

Full stack: `docker compose up --build` → `http://localhost:3000`

Health: `GET /health/live`, `GET /health/ready`

## Technology choices

| Area | Choice | Reason |
|------|--------|--------|
| Framework | NestJS + TypeScript | Modules, guards, and DI fit multi-tenant API design |
| Database | PostgreSQL (Prisma) | Relational model for tenants, flags, audit trail |
| Cache | Redis | Low-latency config reads and per-tenant rate limiting |
| Compute | Cloud Run | Fast deploy, revision-based canary traffic splitting |
| IaC | Terraform | Modular, separate staging/production environments |
| Secrets | GCP Secret Manager | DB/Redis credentials not in plain env vars |
| CI/CD | GitHub Actions | Lint → test → build → canary deploy with rollback |

## Architecture

Clients authenticate with a per-tenant API key. Guards validate the key
(SHA-256 hash, prefix lookup), enforce tenant isolation, and apply per-tenant
rate limits via Redis. Domain modules handle tenant registration, flag CRUD
with audit logging, and flag evaluation.

**Evaluation flow:** auth → rate limit → Redis config cache (hit) or
PostgreSQL (miss, then cache write) → deterministic hash → response.

**Flag update flow:** auth → PostgreSQL transaction (flag update + audit
insert) → Redis cache invalidation.

### Database schema

- **Tenant** — `name`, `slug`
- **Environment** — `development`, `staging`, `production` (one set per tenant)
- **ApiKey** — `key_hash`, `key_prefix`, `active`
- **FeatureFlag** — `flag_key`, `type`, `default_value`, `status`
- **FlagEnvironmentConfig** — `enabled`, `rollout_percentage`, `targeting_rules`, `variant_value`
- **AuditLog** — append-only: `actor`, `action`, `before_value`, `after_value`

Flag identity (`key`, `type`, `defaultValue`) is separate from per-environment
behavior so production changes do not affect staging.

## API

Base path: `/api/v1`. Tenant-scoped routes use `Authorization: Bearer <api_key>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/tenants` | Register tenant; returns API key and three environments |
| POST | `/tenants/{id}/flags` | Create flag (`key`, `type`, `defaultValue`) |
| GET | `/tenants/{id}/flags` | List flags; filter by `environment`, `status` |
| PUT | `/tenants/{id}/flags/{key}` | Update flag; env fields need `environment` |
| DELETE | `/tenants/{id}/flags/{key}` | Archive flag (soft-delete) |
| GET | `/tenants/{id}/flags/{key}/history` | Audit history (newest first) |
| POST | `/evaluate` | Evaluate one flag for a user/context |
| POST | `/evaluate/bulk` | Evaluate all active flags for a user/context |
| GET | `/metrics` | Prometheus metrics |

**Flag types:** `boolean`, `string`, `number`.

**Per-environment fields:** `enabled`, `rolloutPercentage` (0–100),
`targetingRules`, `variantValue`.

**Evaluate request body:** `tenant_id`, `environment`, `user_id`, `context`.
Single evaluate also requires `flag_key`.

**Evaluate response:** `value` and `reason` (`archived`, `disabled`,
`targeting_match`, `rollout`, `not_in_rollout`).

API keys are returned once at registration and stored as SHA-256 hashes.
Audit records are written in the same transaction as flag changes.

## Flag evaluation algorithm

```
bucket = parseInt(sha256("<flag_key>:<user_id>").slice(0, 8), 16) % 100
```

User is in rollout when `bucket < rolloutPercentage`.

- **Deterministic** — same user always gets the same bucket for a flag
- **Monotonic** — increasing rollout % only adds users
- **Independent per flag** — flag key is part of the hash input

**Order:** archived → default → disabled → default → targeting match →
on-value → in rollout → on-value → else default.

## Caching strategy

Single-flag evaluation caches environment config in Redis (5-minute TTL).
Flag mutations invalidate affected keys. Bulk evaluation reads PostgreSQL
directly. Evaluation results are not cached.

## Observability

Structured JSON logging with `x-correlation-id`. Prometheus metrics for
evaluation latency, evaluation count, cache hit/miss, and HTTP errors by
tenant. Cloud Monitoring dashboard and alerts provisioned via Terraform.

## Testing

```bash
npm run lint && npm test && npm run test:integration && npm run build
```

- **Unit tests (63):** rollout hashing, evaluation logic, auth, rate limits, audit
- **Integration tests (11):** tenant isolation, environment scoping, audit trail
- **Load test (`load/k6-evaluate.js`):** 1,447 req/s, p95 ~28ms on `/evaluate`, 0 failures (local, 25 VUs, 30s)

## Infrastructure & deployment

Terraform in `infra/terraform/` provisions Cloud Run, Cloud SQL, Memorystore,
VPC, IAM, Secret Manager, Artifact Registry, and Cloud Monitoring. Staging and
production are separate environments. See [`infra/README.md`](infra/README.md).

**Canary deploy:** build image → deploy at 0% traffic → health smoke tests →
traffic 10% → 50% → 100% → rollback on failure.

**CI:** lint → unit tests → build → integration tests → Docker build.

## Assumptions

- `POST /evaluate` requires `flag_key`; `/evaluate/bulk` returns all active flags
- Tenant registration is unauthenticated
- Audit actor is the API key prefix
- Targeting rules are attribute allow-list equality
- Archived flags return the default value

## Trade-offs

| Decision | Alternative | Why this choice |
|----------|-------------|-----------------|
| SHA-256 for API keys | bcrypt/argon2 | Keys are random high-entropy values, not guessable passwords; bcrypt would add latency on every request |
| Cache flag configs | Cache per-user results | Evaluation hash is cheap; per-user caching multiplies Redis key cardinality |
| Cloud Run | GKE | Revision traffic splitting gives canary/rollback without operating a cluster |
| Fixed-window rate limit | Sliding window | One Redis `INCR` per request; simpler and fast enough for noisy-neighbor protection |

## Future improvements

Real-time flag updates (SSE/WebSocket), API key rotation, richer targeting,
pagination, Managed Prometheus, multi-region deployment.
