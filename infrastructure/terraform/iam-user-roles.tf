# ============================================================================
# Per-user IAM roles — assumed by the Cognito Identity Pool on behalf of
# authenticated users. Each role grants access to exactly one user's S3
# prefix; cross-user access is blocked at the IAM layer.
#
# Browser → Identity Pool → these roles → S3. No proxy in the path.
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

# --- Per-user policy ---
# Each user can:
#   - LIST objects under users/<username>/ in the data bucket
#   - GET/PUT/DELETE objects under users/<username>/ in the data bucket
#   - GET/LIST objects under users/<username>/ in the results bucket
#     (so they can download their own Athena query results directly from S3)
resource "aws_iam_role_policy" "test_user_s3" {
  for_each = local.user_set

  name = "s3-prefix-scope"
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
      {
        Sid      = "ReadOwnResults"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.results.arn}/users/${each.value}/*"
      },
      {
        Sid      = "ListOwnResults"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.results.arn
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
