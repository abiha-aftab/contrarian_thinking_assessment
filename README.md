# Multi-Tenant Feature Flag Service

A production-oriented feature flag and runtime configuration service built for
the Contrarian Thinking Backend & Platform take-home assessment.

## Current status

Phase 1 establishes the NestJS application, PostgreSQL/Prisma data model, Redis
connection, structured request logging, correlation IDs, and health checks.
Tenant APIs, flag management, evaluation, infrastructure, and deployment are
implemented in subsequent phases.

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
