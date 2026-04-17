# ============================================================================
# Per-user IAM roles — assumed by the Cognito Identity Pool on behalf of
# authenticated users. Each role carries EVERY permission the caller needs
# to operate athena-shell: direct-to-S3 browser ops plus the Athena/Glue
# calls that pass through the proxy.
#
# The proxy forwards the caller's STS credentials (from the browser's
# Identity-Pool-minted session) into the AWS SDK when it makes Athena/Glue
# requests — so both paths run under this role, and there is a single
# IAM-enforced boundary. The proxy's own task role no longer carries app
# permissions.
#
# FUTURE (SSO): Replace the for_each on `local.user_set` with a static map
# of groups → roles, or use a single team-scope role if per-user isolation
# isn't needed. The trust policy stays the same shape.
# ============================================================================

# --- Trust policy shared by all per-user roles ---
# Trusts any principal that arrived through our Identity Pool with
# "authenticated" amr. Identity Pool's role mapping rules pick which user
# gets which role (see identity-pool.tf).
data "aws_iam_policy_document" "cognito_identity_trust" {
  statement {
    effect = "Allow"
    principals {
      type        = "Federated"
      identifiers = ["cognito-identity.amazonaws.com"]
    }
    actions = ["sts:AssumeRoleWithWebIdentity"]

    condition {
      test     = "StringEquals"
      variable = "cognito-identity.amazonaws.com:aud"
      values   = [aws_cognito_identity_pool.main.id]
    }

    condition {
      test     = "ForAnyValue:StringLike"
      variable = "cognito-identity.amazonaws.com:amr"
      values   = ["authenticated"]
    }
  }
}

# --- Per-user role ---
resource "aws_iam_role" "test_user" {
  for_each = local.user_set

  name               = "${local.prefix}-user-${each.value}"
  assume_role_policy = data.aws_iam_policy_document.cognito_identity_trust.json

  # Max session = 1 hour. Identity Pool's GetCredentialsForIdentity always
  # returns ≤ 1h creds regardless, so this is defensive — matches reality.
  max_session_duration = 3600
}

# --- S3 scope ---
# Browser-direct S3 (list / upload / download / delete in the user's own
# workspace prefix) + the read surface Athena needs when it runs queries
# under these same creds (proxy forwards them via passthrough middleware).
resource "aws_iam_role_policy" "test_user_s3" {
  for_each = local.user_set

  name = "s3-scope"
  role = aws_iam_role.test_user[each.value].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListOwnPrefixInDataBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.data.arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "users/${each.value}",
              "users/${each.value}/",
              "users/${each.value}/*",
            ]
          }
        }
      },
      {
        Sid    = "ReadWriteOwnPrefixInDataBucket"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ]
        Resource = "${aws_s3_bucket.data.arn}/users/${each.value}/*"
      },
      # Athena (running under these creds, via proxy passthrough) needs
      # to read the data bucket to scan tables whose LOCATION lives
      # under users/<username>/datasets/...  The object-level ListBucket
      # above already keys reads to the user's prefix, so a stray SELECT
      # can't reach someone else's data — Glue would also deny GetTable
      # on another user's workspace_* (see glue-scope policy).
      {
        Sid      = "ReadWriteResultsForAthena"
        Effect   = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
          "s3:GetBucketLocation",
        ]
        Resource = [
          aws_s3_bucket.results.arn,
          "${aws_s3_bucket.results.arn}/*",
        ]
      },
      {
        Sid      = "ListResultsBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.results.arn
      },
    ]
  })
}

# --- Athena scope ---
# One Athena workgroup per user (see athena.tf). The policy pins the full
# query lifecycle — plus named-queries for saved-query library — to THAT
# workgroup. Any attempt to target another user's workgroup is denied by
# IAM, not by app code.
resource "aws_iam_role_policy" "test_user_athena" {
  for_each = local.user_set

  name = "athena-scope"
  role = aws_iam_role.test_user[each.value].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AthenaQueryLifecycle"
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:StopQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:GetQueryResultsStream",
          "athena:ListQueryExecutions",
          "athena:BatchGetQueryExecution",
          "athena:GetWorkGroup",
          "athena:ListWorkGroups",
          "athena:CreateNamedQuery",
          "athena:ListNamedQueries",
          "athena:BatchGetNamedQuery",
          "athena:DeleteNamedQuery",
        ]
        Resource = aws_athena_workgroup.user[each.value].arn
      },
    ]
  })
}

# --- Glue scope ---
# Reads: the shared demo catalog entries + the caller's own workspace_<user>
# database. No access to other users' workspace_* databases — cross-user
# table references are denied by Glue before Athena ever executes the plan.
# Writes: CreateDatabase (idempotent on first dataset registration) and
# table RW on workspace_<user> only.
resource "aws_iam_role_policy" "test_user_glue" {
  for_each = local.user_set

  name = "glue-scope"
  role = aws_iam_role.test_user[each.value].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "GlueReadCatalog"
        Effect = "Allow"
        Action = [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartition",
          "glue:GetPartitions",
        ]
        Resource = [
          "arn:aws:glue:${var.region}:${local.account_id}:catalog",
          "arn:aws:glue:${var.region}:${local.account_id}:database/${aws_glue_catalog_database.main.name}",
          "arn:aws:glue:${var.region}:${local.account_id}:table/${aws_glue_catalog_database.main.name}/*",
          "arn:aws:glue:${var.region}:${local.account_id}:database/workspace_${each.value}",
          "arn:aws:glue:${var.region}:${local.account_id}:table/workspace_${each.value}/*",
        ]
      },
      {
        Sid    = "GlueWriteOwnWorkspace"
        Effect = "Allow"
        Action = [
          "glue:CreateDatabase",
          "glue:CreateTable",
          "glue:UpdateTable",
          "glue:DeleteTable",
          "glue:BatchCreatePartition",
          "glue:BatchDeletePartition",
        ]
        Resource = [
          "arn:aws:glue:${var.region}:${local.account_id}:catalog",
          "arn:aws:glue:${var.region}:${local.account_id}:database/workspace_${each.value}",
          "arn:aws:glue:${var.region}:${local.account_id}:table/workspace_${each.value}/*",
        ]
      },
    ]
  })
}

# --- Fallback authenticated role — no permissions ---
# Referenced by the Identity Pool's `roles.authenticated` slot. Users who
# authenticate but don't match any mapping rule receive this role and can
# read/write nothing.
resource "aws_iam_role" "fallback_authenticated" {
  name               = "${local.prefix}-fallback-authenticated"
  assume_role_policy = data.aws_iam_policy_document.cognito_identity_trust.json
}

# Intentionally no policies attached.
