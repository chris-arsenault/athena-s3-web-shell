variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "prefix" {
  description = "Resource name prefix. Used in IAM, ECS, S3, Athena, Glue, etc."
  type        = string
  default     = "athena-shell"
}

variable "hostname" {
  description = "Public hostname for the demo. A DNS A-ALIAS record is created in the shared ahara.io zone."
  type        = string
  default     = "shell.ahara.io"
}

variable "ahara_zone_name" {
  description = "Route53 zone name (must already exist in the account)."
  type        = string
  default     = "ahara.io"
}

# --- Listener rule priority block ---
# ahara consumers: dosekit=201, tastebase=210-214, svap=300-302.
# athena-shell reserves 220-229.
variable "alb_priority_api" {
  description = "ALB listener rule priority for shell.ahara.io/api/* (JWT-validated)."
  type        = number
  default     = 220
}

variable "alb_priority_spa" {
  description = "ALB listener rule priority for shell.ahara.io/* (unauthenticated SPA)."
  type        = number
  default     = 221
}

variable "test_user_names" {
  description = "Cognito usernames to provision for the demo. Each gets a dedicated IAM role + Athena workgroup + S3 prefix."
  type        = list(string)
  default     = ["test_athena_1", "test_athena_2", "test_athena_3"]
}

variable "athena_bytes_scanned_cutoff" {
  description = "Per-query data-scan ceiling (bytes). Demo-sized (1 GB); raise for prod."
  type        = number
  default     = 1073741824
}
