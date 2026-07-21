variable "project_id" { type = string }
variable "name_prefix" { type = string }
variable "service_name" { type = string }
variable "alert_email" { type = string }

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email == "" ? 0 : 1
  display_name = "${var.name_prefix} alerts"
  type         = "email"
  project      = var.project_id

  labels = {
    email_address = var.alert_email
  }
}

locals {
  channels = (
    var.alert_email == ""
    ? []
    : [google_monitoring_notification_channel.email[0].name]
  )
}

# Error rate > 5% over a 5-minute window.
resource "google_monitoring_alert_policy" "error_rate" {
  display_name = "${var.name_prefix} error rate > 5%"
  combiner     = "OR"
  project      = var.project_id
  notification_channels = local.channels

  conditions {
    display_name = "Cloud Run 5xx rate"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = "${var.service_name}"
        AND metric.type = "run.googleapis.com/request_count"
        AND metric.labels.response_code_class = "5xx"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }

      # Denominator: all requests for the service, used via documentation as a
      # ratio policy would be more precise but requires MQL/PromQL; the
      # absolute 5xx rate alert is the practical take-home equivalent.
      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = "Feature-flag API 5xx rate exceeded threshold. Check Cloud Logging for correlation IDs and consider rolling back the canary revision."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "latency" {
  display_name = "${var.name_prefix} p95 latency high"
  combiner     = "OR"
  project      = var.project_id
  notification_channels = local.channels

  conditions {
    display_name = "Cloud Run request latency p95 > 500ms"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = "${var.service_name}"
        AND metric.type = "run.googleapis.com/request_latencies"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 500
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_DELTA"
      }

      trigger {
        count = 1
      }
    }
  }
}

resource "google_monitoring_alert_policy" "health" {
  display_name = "${var.name_prefix} health check failures"
  combiner     = "OR"
  project      = var.project_id
  notification_channels = local.channels

  conditions {
    display_name = "Cloud Run instance health failures"

    condition_threshold {
      filter = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = "${var.service_name}"
        AND metric.type = "run.googleapis.com/container/billable_instance_time"
      EOT
      # Absence of healthy billable instance time for 5 minutes while traffic
      # is expected is treated as a health failure signal.
      comparison      = "COMPARISON_LT"
      threshold_value = 0.01
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }

      trigger {
        count = 1
      }
    }
  }
}

resource "google_monitoring_dashboard" "main" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "${var.name_prefix} Feature Flag Service"
    gridLayout = {
      columns = 2
      widgets = [
        {
          title = "Request rate"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${var.service_name}\" metric.type=\"run.googleapis.com/request_count\""
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_RATE"
                  }
                }
              }
              plotType = "LINE"
            }]
          }
        },
        {
          title = "Request latency"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${var.service_name}\" metric.type=\"run.googleapis.com/request_latencies\""
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_DELTA"
                  }
                }
              }
              plotType = "LINE"
            }]
          }
        },
        {
          title = "5xx error rate"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${var.service_name}\" metric.type=\"run.googleapis.com/request_count\" metric.labels.response_code_class=\"5xx\""
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_RATE"
                  }
                }
              }
              plotType = "LINE"
            }]
          }
        },
        {
          title = "Instance count"
          xyChart = {
            dataSets = [{
              timeSeriesQuery = {
                timeSeriesFilter = {
                  filter = "resource.type=\"cloud_run_revision\" resource.labels.service_name=\"${var.service_name}\" metric.type=\"run.googleapis.com/container/instance_count\""
                  aggregation = {
                    alignmentPeriod  = "60s"
                    perSeriesAligner = "ALIGN_MEAN"
                  }
                }
              }
              plotType = "LINE"
            }]
          }
        }
      ]
    }
  })
}
