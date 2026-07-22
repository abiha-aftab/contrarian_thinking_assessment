variable "project_id" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "labels" { type = map(string) }
variable "image" { type = string }
variable "runtime_sa" { type = string }
variable "vpc_network_name" { type = string }
variable "vpc_subnet_name" { type = string }
variable "database_url_secret" { type = string }
variable "redis_url_secret" { type = string }
variable "cloudsql_connection" { type = string }
variable "min_instances" { type = number }
variable "max_instances" { type = number }

resource "google_cloud_run_v2_service" "api" {
  name     = "${var.name_prefix}-api"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = var.runtime_sa
    labels          = var.labels

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Direct VPC egress — no Serverless VPC Access connector required.
    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"
      network_interfaces {
        network    = var.vpc_network_name
        subnetwork = var.vpc_subnet_name
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloudsql_connection]
      }
    }

    containers {
      image = var.image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          path = "/health/live"
          port = 3000
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 12
      }

      liveness_probe {
        http_get {
          path = "/health/ready"
          port = 3000
        }
        period_seconds    = 15
        failure_threshold = 3
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      # PORT is set automatically by Cloud Run from container_port — do not set it.

      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      env {
        name  = "RUN_MIGRATIONS"
        value = "true"
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_url_secret
            version = "latest"
          }
        }
      }

      env {
        name = "REDIS_URL"
        value_source {
          secret_key_ref {
            secret  = var.redis_url_secret
            version = "latest"
          }
        }
      }
    }
  }

  # Traffic splitting for canary / blue-green is managed by the deploy
  # workflow via `gcloud run services update-traffic`, not by Terraform, so
  # a terraform apply does not reset a partial canary rollout.
  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].containers[0].image,
      traffic,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "service_name" {
  value = google_cloud_run_v2_service.api.name
}
