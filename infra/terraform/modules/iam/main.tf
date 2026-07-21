variable "project_id" { type = string }
variable "name_prefix" { type = string }

resource "google_service_account" "runtime" {
  account_id   = "${var.name_prefix}-runtime"
  display_name = "Feature Flag Service runtime"
  project      = var.project_id
}

# Least privilege: Cloud SQL client, Secret Manager accessor, logging & monitoring.
resource "google_project_iam_member" "runtime_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/secretmanager.secretAccessor",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

output "runtime_email" {
  value = google_service_account.runtime.email
}
