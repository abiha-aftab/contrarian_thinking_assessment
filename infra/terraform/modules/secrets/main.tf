variable "project_id" { type = string }
variable "name_prefix" { type = string }
variable "labels" { type = map(string) }
variable "runtime_sa" { type = string }

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "${var.name_prefix}-db-password"
  project   = var.project_id
  labels    = var.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db.result
}

# DATABASE_URL and REDIS_URL are written by the Cloud SQL / Redis modules after
# their addresses are known; these secrets are created empty and populated
# via google_secret_manager_secret_version resources in those modules through
# the secret IDs exported here. For Cloud Run we reference the secret by ID
# and Cloud Run always mounts the latest enabled version.
resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.name_prefix}-database-url"
  project   = var.project_id
  labels    = var.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "redis_url" {
  secret_id = "${var.name_prefix}-redis-url"
  project   = var.project_id
  labels    = var.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = {
    db_password  = google_secret_manager_secret.db_password.id
    database_url = google_secret_manager_secret.database_url.id
    redis_url    = google_secret_manager_secret.redis_url.id
  }

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.runtime_sa}"
  project   = var.project_id
}

output "db_password_secret_id" {
  value = google_secret_manager_secret.db_password.secret_id
}

output "db_password" {
  value     = random_password.db.result
  sensitive = true
}

output "database_url_secret_id" {
  value = google_secret_manager_secret.database_url.secret_id
}

output "redis_url_secret_id" {
  value = google_secret_manager_secret.redis_url.secret_id
}

output "database_url_secret_resource" {
  value = google_secret_manager_secret.database_url.id
}

output "redis_url_secret_resource" {
  value = google_secret_manager_secret.redis_url.id
}
