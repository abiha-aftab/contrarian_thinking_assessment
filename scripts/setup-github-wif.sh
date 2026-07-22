#!/usr/bin/env bash
# Sets up Workload Identity Federation so GitHub Actions can deploy to GCP
# without a long-lived service account JSON key.
#
# Usage:
#   export GCP_PROJECT_ID=future-infusion-503216-p3
#   export GITHUB_REPO=abiha-aftab/contrarian_thinking_assessment
#   bash scripts/setup-github-wif.sh
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
GITHUB_REPO="${GITHUB_REPO:?Set GITHUB_REPO (owner/name)}"
REGION="${REGION:-us-central1}"
POOL_ID="${POOL_ID:-github-pool}"
PROVIDER_ID="${PROVIDER_ID:-github-provider}"
SA_ID="${SA_ID:-github-deploy}"

echo "Project:  ${PROJECT_ID}"
echo "Repo:     ${GITHUB_REPO}"
echo

gcloud config set project "${PROJECT_ID}"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
SA_EMAIL="${SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Enabling APIs..."
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com

echo "Creating deploy service account (if missing)..."
gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "${SA_ID}" \
       --display-name="GitHub Actions deploy"

for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor
do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

# Cloud Run runtime SA may need to be impersonated when updating the service.
RUNTIME_SA="ff-staging-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1; then
  gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/iam.serviceAccountUser" \
    --quiet >/dev/null || true
fi

echo "Creating Workload Identity Pool (if missing)..."
gcloud iam workload-identity-pools describe "${POOL_ID}" \
  --location="global" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "${POOL_ID}" \
       --location="global" \
       --display-name="GitHub Actions pool"

echo "Creating GitHub OIDC provider (if missing)..."
gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
  --location="global" \
  --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
       --location="global" \
       --workload-identity-pool="${POOL_ID}" \
       --display-name="GitHub provider" \
       --issuer-uri="https://token.actions.githubusercontent.com" \
       --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
       --attribute-condition="assertion.repository=='${GITHUB_REPO}'"

MEMBER="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"

echo "Allowing GitHub repo to impersonate ${SA_EMAIL}..."
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${MEMBER}" \
  --quiet >/dev/null

PROVIDER_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"

echo
echo "Done. Add these GitHub Actions repository secrets:"
echo
echo "  GCP_PROJECT_ID=${PROJECT_ID}"
echo "  GCP_DEPLOY_SA=${SA_EMAIL}"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER=${PROVIDER_RESOURCE}"
echo
echo "Repo → Settings → Secrets and variables → Actions → New repository secret"
echo "Then push to main (or re-run the Deploy workflow)."
