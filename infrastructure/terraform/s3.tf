# ============================================================================
# S3 buckets — user workspaces + Athena query results.
#
# Data bucket layout (per-user prefix isolation):
#   s3://athena-shell-data-<acct>/users/test_athena_1/...
#   s3://athena-shell-data-<acct>/users/test_athena_2/...
#   s3://athena-shell-data-<acct>/users/test_athena_3/...
#
# Results bucket layout (per-user prefix; workgroup's output location):
#   s3://athena-shell-results-<acct>/users/test_athena_1/<queryid>.csv
#   ...
#
# Access model:
#   - Browser → S3: via Identity Pool STS creds, scoped by per-user IAM role.
#     Data bucket gets CORS for the SPA origin.
#   - Proxy   → S3: via task role for Athena reads + writes on results.
#     Results are written by Athena itself using whatever creds called
#     StartQueryExecution (the proxy task role).
# ============================================================================

# --- Data bucket ---
resource "aws_s3_bucket" "data" {
  bucket = "${local.prefix}-data-${local.account_id}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket = aws_s3_bucket.data.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

# CORS — browser-direct PUT/GET from the SPA origin.
# Must match the SPA's origin exactly (no wildcards for a public-facing demo).
resource "aws_s3_bucket_cors_configuration" "data" {
  bucket = aws_s3_bucket.data.id

  cors_rule {
    allowed_methods = ["GET", "PUT", "POST", "DELETE", "HEAD"]
    allowed_origins = ["https://${local.hostname}"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag", "x-amz-request-id", "x-amz-version-id"]
    max_age_seconds = 3000
  }
}

# Seed per-user prefixes so a fresh account still lists sensibly.
# S3 has no concept of folders; this zero-byte `.keep` makes the prefix
# enumerate under ListObjectsV2 with a Delimiter.
resource "aws_s3_object" "data_user_prefix" {
  for_each = local.user_set

  bucket  = aws_s3_bucket.data.id
  key     = "users/${each.value}/.keep"
  content = ""
}

# --- Results bucket ---
resource "aws_s3_bucket" "results" {
  bucket = "${local.prefix}-results-${local.account_id}"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "results" {
  bucket = aws_s3_bucket.results.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "results" {
  bucket = aws_s3_bucket.results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle — expire query results after 30 days. Matches typical analyst
# workflows where you either download the CSV or rerun. Prod would tune
# based on org retention policy.
resource "aws_s3_bucket_lifecycle_configuration" "results" {
  bucket = aws_s3_bucket.results.id

  rule {
    id     = "expire-old-results"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}
