# Infrastructure

Terraform for running the feature-flag service on Google Cloud. Nothing here is
needed for local development; `docker compose up` covers that.

## Layout

```
infra/terraform/
├── modules/
│   ├── apis/               # Enables the required Google APIs
│   ├── networking/         # VPC and private service access
│   ├── iam/                # Least-privilege runtime service account
│   ├── secrets/            # Secret Manager: DB password, DATABASE_URL, REDIS_URL
│   ├── cloudsql/           # Private-IP PostgreSQL 15
│   ├── redis/              # Memorystore Redis 7 (BASIC tier)
│   ├── artifact_registry/  # Docker image repository
│   ├── cloudrun/           # Cloud Run service with probes and secret env
│   └── monitoring/         # Dashboard and alert policies
└── envs/
    ├── staging/
    └── production/
```

Each environment composes the same modules with its own sizing in
`terraform.tfvars` (copy it from `terraform.tfvars.example`). Remote state in a
GCS bucket is optional and commented out in `backend.tf`.

## Why these services

| Need | Choice | Why |
|------|--------|-----|
| Compute | Cloud Run | Public HTTPS URL without a cluster; revision traffic splitting allows canary rollouts; staging scales to zero |
| Database | Cloud SQL PostgreSQL 15, private IP | Managed backups and point-in-time recovery |
| Cache | Memorystore Redis | BASIC is enough for staging; production can switch to STANDARD_HA |
| Secrets | Secret Manager | Credentials are injected at runtime, never baked into images |
| Images | Artifact Registry | Same project and region as Cloud Run |
| Networking | VPC | Cloud Run reaches the private Cloud SQL and Redis instances |
| Observability | Cloud Monitoring | Dashboard plus alerts on error rate, latency and health |

## Provisioning

```bash
gcloud auth application-default login
gcloud config set project YOUR_GCP_PROJECT_ID

cd infra/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars   # set project_id and image
terraform init
terraform plan
terraform apply
```

The first apply creates the Artifact Registry repository. Push an image to it
(or point `image` at a public placeholder for the first run), then apply again.

## Rolling out a new image

Terraform deliberately ignores the Cloud Run image and traffic split
(`lifecycle.ignore_changes` in `modules/cloudrun`), so a canary can be run by
hand without the next `terraform apply` undoing it:

```bash
IMAGE=us-central1-docker.pkg.dev/$PROJECT/ff-staging-images/feature-flag-service:$TAG
docker build -f docker/Dockerfile -t "$IMAGE" . && docker push "$IMAGE"

# New revision with 0% traffic, reachable on its own tagged URL
gcloud run deploy ff-staging-api --image "$IMAGE" --region us-central1 \
  --no-traffic --tag canary
curl -fsS "https://canary---<service-url-host>/health/ready"

# Shift traffic in steps, or send it all back to the previous revision
gcloud run services update-traffic ff-staging-api --region us-central1 --to-tags canary=10
gcloud run services update-traffic ff-staging-api --region us-central1 --to-latest
```

Migrations run on container start (`RUN_MIGRATIONS=true`, `prisma migrate
deploy`), so the new revision applies any pending schema changes before it
serves traffic.

## Teardown

```bash
cd infra/terraform/envs/staging
terraform destroy
```
