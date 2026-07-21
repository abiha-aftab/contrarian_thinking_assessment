variable "project_id" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "labels" { type = map(string) }
variable "network_id" { type = string }
variable "private_vpc_connection" { type = string }
variable "tier" { type = string }
variable "db_password_secret" { type = string }

data "google_secret_manager_secret_version" "db_password" {
  secret  = var.db_password_secret
  project = var.project_id
}

resource "google_sql_database_instance" "postgres" {
  name             = "${var.name_prefix}-pg"
  database_version = "POSTGRES_15"
  region           = var.region
  project          = var.project_id

  settings {
    tier              = var.tier
    availability_type = "ZONAL"
    disk_size         = 20
    disk_type         = "PD_SSD"

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
    }

    user_labels = var.labels
  }

  deletion_protection = false

  depends_on = [var.private_vpc_connection]
}

resource "google_sql_database" "feature_flags" {
  name     = "feature_flags"
  instance = google_sql_database_instance.postgres.name
  project  = var.project_id
}

resource "google_sql_user" "app" {
  name     = "feature_flags"
  instance = google_sql_database_instance.postgres.name
  password = data.google_secret_manager_secret_version.db_password.secret_data
  project  = var.project_id
}

output "connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "private_ip" {
  value = google_sql_database_instance.postgres.private_ip_address
}

output "database_url" {
  sensitive = true
  value = format(
    "postgresql://feature_flags:%s@%s:5432/feature_flags?schema=public",
    data.google_secret_manager_secret_version.db_password.secret_data,
    google_sql_database_instance.postgres.private_ip_address,
  )
}
