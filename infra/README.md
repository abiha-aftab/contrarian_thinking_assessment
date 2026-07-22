# Infrastructure

Terraform modules that provision the GCP stack for the feature-flag service.

## Layout

```
infra/terraform/
├── modules/           # Reusable building blocks
│   ├── apis/
│   ├── networking/    # VPC, private service access
│   ├── iam/           # Least-privilege runtime service account
│   ├── secrets/       # Secret Manager (DB password, DATABASE_URL, REDIS_URL)
│   ├── cloudsql/      # Private IP PostgreSQL 15
│   ├── redis/         # Memorystore Redis 7 (BASIC tier for staging)
│   ├── artifact_registry/
│   ├── cloudrun/      # Cloud Run service with probes + secret env
│   └── monitoring/    # Dashboard + alert policies
└── envs/
    ├── staging/
    └── production/
```

## Why these GCP services

| Need | Choice | Why |
|------|--------|-----|
| Compute | Cloud Run | Fastest path to a public URL; native revision traffic splitting for canary/blue-green; scales to zero in staging |
| Database | Cloud SQL PostgreSQL 15 (private IP) | Required by the assessment; managed backups and PITR |
| Cache | Memorystore Redis BASIC | Required; BASIC is enough for staging cost; production can flip to STANDARD_HA |
| Secrets | Secret Manager | Never bake credentials into images or plain env vars |
| Images | Artifact Registry | Required by the CI/CD flow |
| Networking | VPC | Cloud Run reaches private Cloud SQL / Redis |
| Observability | Cloud Monitoring | Dashboard + alerts for error rate, latency, health |

## Deployment strategy: Cloud Run canary

1. CI builds and pushes a new image tagged with the git SHA.
2. `gcloud run deploy --no-traffic --tag=canary` creates a new revision receiving
   **0%** of production traffic.
3. Smoke tests hit the tagged canary URL (`https://canary---…`).
4. Traffic shifts: 10% → 50% → 100% (`--to-latest`).
5. On smoke/canary failure the workflow routes 100% back to the previous
   revision — automatic rollback.

Terraform manages the service, secrets, networking, and monitoring, but
**ignores** image and traffic changes so a `terraform apply` cannot reset an
in-progress canary.

## First-time setup

```bash
# 1. Create a GCP project and enable billing (free tier / $300 credits).
# 2. Authenticate locally.
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID

# 3. Optional remote state bucket.
gsutil mb -l us-central1 gs://YOUR_TF_STATE_BUCKET

# 4. Copy and fill tfvars.
cd infra/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars
# edit project_id / image

# 5. Apply (first apply provisions Artifact Registry; push an image, then
#    re-apply or set image to a public placeholder for the initial create).
terraform init
terraform plan
terraform apply
```

## GitHub Actions → GCP (Workload Identity Federation)

Production-standard auth: GitHub OIDC → Workload Identity Pool → deploy
service account. **No JSON key** is stored in GitHub.

### One-time setup

```bash
export GCP_PROJECT_ID=future-infusion-503216-p3
export GITHUB_REPO=abiha-aftab/contrarian_thinking_assessment
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"

bash scripts/setup-github-wif.sh
```

The script prints three values. Add them as **repository secrets**:

| Secret | Meaning |
|--------|---------|
| `GCP_PROJECT_ID` | GCP project ID |
| `GCP_DEPLOY_SA` | `github-deploy@….iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full provider resource name |

Then push to `main`. The Deploy workflow uses
`google-github-actions/auth` with `workload_identity_provider` +
`service_account` and `permissions.id-token: write`.

## Teardown

```bash
cd infra/terraform/envs/staging
terraform destroy
```
