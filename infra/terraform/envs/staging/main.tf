terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all regional resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name used for resource naming and tagging"
  type        = string
}

variable "image" {
  description = "Fully-qualified container image to deploy (Artifact Registry)"
  type        = string
}

variable "db_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-f1-micro"
}

variable "redis_memory_gb" {
  description = "Memorystore Redis memory size in GiB"
  type        = number
  default     = 1
}

variable "cloud_run_min_instances" {
  type    = number
  default = 0
}

variable "cloud_run_max_instances" {
  type    = number
  default = 5
}

variable "alert_email" {
  description = "Email for Cloud Monitoring alert notifications (empty to skip)"
  type        = string
  default     = ""
}

locals {
  name_prefix = "ff-${var.environment}"
  labels = {
    app         = "feature-flag-service"
    environment = var.environment
    managed_by  = "terraform"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "apis" {
  source     = "../../modules/apis"
  project_id = var.project_id
}

module "networking" {
  source      = "../../modules/networking"
  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.labels

  depends_on = [module.apis]
}

module "iam" {
  source      = "../../modules/iam"
  project_id  = var.project_id
  name_prefix = local.name_prefix

  depends_on = [module.apis]
}

module "secrets" {
  source      = "../../modules/secrets"
  project_id  = var.project_id
  name_prefix = local.name_prefix
  labels      = local.labels
  runtime_sa  = module.iam.runtime_email

  depends_on = [module.apis]
}

module "cloudsql" {
  source              = "../../modules/cloudsql"
  project_id          = var.project_id
  region              = var.region
  name_prefix         = local.name_prefix
  labels              = local.labels
  network_id          = module.networking.network_id
  private_vpc_connection = module.networking.private_vpc_connection
  tier                = var.db_tier
  db_password_secret  = module.secrets.db_password_secret_id

  depends_on = [module.networking, module.secrets]
}

module "redis" {
  source      = "../../modules/redis"
  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.labels
  network_id  = module.networking.network_id
  memory_gb   = var.redis_memory_gb

  depends_on = [module.networking]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = module.secrets.database_url_secret_resource
  secret_data = module.cloudsql.database_url
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret      = module.secrets.redis_url_secret_resource
  secret_data = module.redis.redis_url
}

module "artifact_registry" {
  source      = "../../modules/artifact_registry"
  project_id  = var.project_id
  region      = var.region
  name_prefix = local.name_prefix
  labels      = local.labels

  depends_on = [module.apis]
}

module "cloudrun" {
  source                 = "../../modules/cloudrun"
  project_id             = var.project_id
  region                 = var.region
  name_prefix            = local.name_prefix
  labels                 = local.labels
  image                  = var.image
  runtime_sa             = module.iam.runtime_email
  vpc_network_name       = module.networking.network_name
  vpc_subnet_name        = module.networking.subnet_name
  database_url_secret    = module.secrets.database_url_secret_id
  redis_url_secret       = module.secrets.redis_url_secret_id
  min_instances          = var.cloud_run_min_instances
  max_instances          = var.cloud_run_max_instances
  cloudsql_connection    = module.cloudsql.connection_name

  depends_on = [
    module.cloudsql,
    module.redis,
    module.secrets,
    module.artifact_registry,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.redis_url,
  ]
}

module "monitoring" {
  source       = "../../modules/monitoring"
  project_id   = var.project_id
  name_prefix  = local.name_prefix
  service_name = module.cloudrun.service_name
  alert_email  = var.alert_email

  depends_on = [module.cloudrun]
}

output "service_url" {
  description = "Public Cloud Run URL for the feature-flag API"
  value       = module.cloudrun.service_url
}

output "artifact_registry" {
  value = module.artifact_registry.repository_url
}

output "cloudsql_connection" {
  value = module.cloudsql.connection_name
}

output "runtime_service_account" {
  value = module.iam.runtime_email
}
