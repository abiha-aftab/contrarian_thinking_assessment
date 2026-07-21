variable "project_id" { type = string }
variable "region" { type = string }
variable "name_prefix" { type = string }
variable "labels" { type = map(string) }

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_compute_network" "vpc" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
  project                 = var.project_id
}

resource "google_compute_subnetwork" "subnet" {
  name          = "${var.name_prefix}-subnet"
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
  project       = var.project_id
}

resource "google_compute_global_address" "private_ip" {
  name          = "${var.name_prefix}-psa"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
  project       = var.project_id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# Cloud Run Direct VPC egress needs the serverless service agent on the subnet.
resource "google_compute_subnetwork_iam_member" "run_network_user" {
  project    = var.project_id
  region     = var.region
  subnetwork = google_compute_subnetwork.subnet.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:service-${data.google_project.current.number}@serverless-robot-prod.iam.gserviceaccount.com"
}

output "network_id" {
  value = google_compute_network.vpc.id
}

output "network_name" {
  value = google_compute_network.vpc.name
}

output "subnet_name" {
  value = google_compute_subnetwork.subnet.name
}

output "private_vpc_connection" {
  value = google_service_networking_connection.private_vpc.id
}
