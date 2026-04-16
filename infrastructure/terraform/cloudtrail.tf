# ============================================================================
# S3 audit via CloudTrail data events.
#
# Proxy audit (CloudWatch Logs, kind=audit JSON events) covers Athena +
# Glue + datasets operations — anything that passes through our server.
# But browser-direct S3 (list/upload/download/delete via the user's
# Identity-Pool-minted STS creds) never touches the proxy.
#
# CloudTrail data events are the authoritative source for S3 activity:
# S3 API calls land there regardless of where the caller is, tagged with
# the IAM identity (the per-user role, see iam-user-roles.tf). No client
# cooperation required.
#
# FUTURE (compliance hardening): add a Firehose subscription → audit-only
# S3 bucket with Object Lock + a long retention policy for legal hold.
# Plain CloudTrail → S3 with versioning + block-public-access is enough
# for the demo.
# ============================================================================

# Dedicated bucket for the trail. Separated from the data + results
# buckets so retention on audit logs can diverge from the data's
# lifecycle rules.
resource "aws_s3_bucket" "cloudtrail" {
  bucket        = "${local.prefix}-cloudtrail-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail" {
  bucket                  = aws_s3_bucket.cloudtrail.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Bucket policy lets only the CloudTrail service principal write, scoped
# to the canonical AWSLogs/<account>/* prefix. GetBucketAcl is required
# by CloudTrail before it puts its first object.
data "aws_iam_policy_document" "cloudtrail_bucket" {
  statement {
    sid     = "AWSCloudTrailAclCheck"
    effect  = "Allow"
    actions = ["s3:GetBucketAcl"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    resources = [aws_s3_bucket.cloudtrail.arn]
  }

  statement {
    sid     = "AWSCloudTrailWrite"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    resources = ["${aws_s3_bucket.cloudtrail.arn}/AWSLogs/${local.account_id}/*"]
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  policy = data.aws_iam_policy_document.cloudtrail_bucket.json
}

# Trail — scoped to data events on the two project-owned buckets. No
# management events (they'd flood the trail and aren't the compliance
# target here). Log file validation enabled so tampering with the log
# objects at rest is detectable.
resource "aws_cloudtrail" "s3_data_events" {
  name                          = "${local.prefix}-s3-data-events"
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  include_global_service_events = false
  is_multi_region_trail         = false
  enable_log_file_validation    = true

  event_selector {
    read_write_type           = "All"
    include_management_events = false

    data_resource {
      type = "AWS::S3::Object"
      values = [
        "${aws_s3_bucket.data.arn}/",
        "${aws_s3_bucket.results.arn}/",
      ]
    }
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail]
}
