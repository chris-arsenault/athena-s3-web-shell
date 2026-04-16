# ============================================================================
# Athena workgroups + Glue database.
#
# Per-user workgroups — one per test user, each with:
#   - Enforced config (users can't override output location)
#   - Output to s3://<results-bucket>/users/<user>/
#   - CloudWatch metrics enabled for query-level visibility
#   - Bytes-scanned cutoff as a safety rail
#
# The proxy's task role (iam-proxy.tf) has Athena access on all 3 workgroups;
# the proxy looks up the caller's mapped workgroup from DynamoDB
# (dynamodb.tf) and passes *only that one* into StartQueryExecution. Users
# cannot target another user's workgroup because the proxy code enforces it
# — cross-workgroup leakage would be an app bug, not an IAM boundary.
#
# FUTURE (SSO): Replace `for_each = local.user_set` with `for_each = team_set`
# where team_set comes from the SSO group list. Workgroups become team-wide
# rather than per-user — more realistic for shared data exploration.
# ============================================================================

# --- Glue catalog database ---
# Single shared database for the demo. All test users browse the same
# catalog metadata; isolation happens at the workgroup + S3-prefix layers.
resource "aws_glue_catalog_database" "main" {
  name        = replace("${local.prefix}_demo", "-", "_")
  description = "athena-shell demo — shared Glue catalog"
}

# --- Per-user Athena workgroups ---
resource "aws_athena_workgroup" "user" {
  for_each = local.user_set

  name        = "${local.prefix}-${each.value}"
  state       = "ENABLED"
  description = "Scoped workgroup for ${each.value}"

  # force_destroy so `terraform destroy` succeeds even if the workgroup has
  # query history. Remove this for prod.
  force_destroy = true

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    bytes_scanned_cutoff_per_query     = var.athena_bytes_scanned_cutoff

    result_configuration {
      output_location = "s3://${aws_s3_bucket.results.id}/users/${each.value}/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }
}
