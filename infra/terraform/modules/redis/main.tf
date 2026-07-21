variable "project_id" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "labels" { type = map(string) }
variable "network_id" { type = string }
variable "memory_gb" { type = number }

resource "google_redis_instance" "cache" {
  name               = "${var.name_prefix}-redis"
  tier               = "BASIC"
  memory_size_gb     = var.memory_gb
  region             = var.region
  project            = var.project_id
  redis_version      = "REDIS_7_0"
  authorized_network = var.network_id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  labels             = var.labels

  # BASIC tier is intentional for staging: Memorystore Standard doubles cost
  # for HA that a take-home staging environment does not need. Production can
  # override memory_gb and switch to STANDARD_HA.
}

output "host" {
  value = google_redis_instance.cache.host
}

output "port" {
  value = google_redis_instance.cache.port
}

output "redis_url" {
  value = format("redis://%s:%d", google_redis_instance.cache.host, google_redis_instance.cache.port)
}
