# ============================================================================
# Proxy IAM — two roles:
#
#   proxy_task — the identity the container runs as. Has Athena / Glue /
#     DynamoDB / S3 permissions for the proxy's pass-through operations.
#     NOTE: Deliberately does NOT have sts:AssumeRole on the per-user roles.
#     Per-user S3 scoping is enforced by the Cognito Identity Pool giving
#     creds directly to the browser. The proxy handles ONLY Athena/Glue.
#
#   proxy_exec — standard ECS execution role: ECR image pull + CloudWatch
#     log writes. No app-level permissions.
# ============================================================================

# --- Task role ---
data "aws_iam_policy_document" "proxy_task_trust" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "proxy_task" {
  name               = "${local.prefix}-proxy-task"
  assume_role_policy = data.aws_iam_policy_document.proxy_task_trust.json
}

resource "aws_iam_role_policy" "proxy_task" {
  name = "athena-glue-data-access"
  role = aws_iam_role.proxy_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AthenaPerUserWorkgroups"
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
          # Named-query library (issue #9). ListNamedQueries + BatchGet
          # back the sidebar listing; CreateNamedQuery backs "save query",
          # DeleteNamedQuery backs the × on each row. Scoped to the
          # per-user workgroups — named queries ARE per-workgroup in
          # Athena, so listing another user's can't happen here.
          "athena:CreateNamedQuery",
          "athena:ListNamedQueries",
          "athena:BatchGetNamedQuery",
          "athena:DeleteNamedQuery",
        ]
        # Scope athena ops to the 3 per-user workgroups only.
        # FUTURE (SSO): widen this to a pattern like
        #   arn:aws:athena:*:*:workgroup/${local.prefix}-team-*
        Resource = [for wg in aws_athena_workgroup.user : wg.arn]
      },
      {
        Sid    = "GlueReadSharedCatalog"
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
          "arn:aws:glue:${var.region}:${local.account_id}:database/workspace_*",
          "arn:aws:glue:${var.region}:${local.account_id}:table/workspace_*/*",
        ]
      },
      # Datasets flow (issue #5): POST /api/datasets/create-table issues
      # CREATE DATABASE IF NOT EXISTS workspace_<username>, then CREATE
      # EXTERNAL TABLE. Athena executes those via the Glue Data Catalog,
      # so the proxy task role needs matching Glue write permissions.
      # Scoped to workspace_* (per-user DBs) and the demo glue DB — the
      # proxy's route-layer validation (datasets.ts validateCreateTable)
      # enforces `body.database === req.user.athena.userDatabase`, so
      # a user can only ever ask for their own workspace_<username>.
      #
      # FUTURE (SSO): widen to `database/team_*` when per-team catalogs
      # replace per-user ones.
      {
        Sid    = "GlueWriteUserWorkspaces"
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
          "arn:aws:glue:${var.region}:${local.account_id}:database/workspace_*",
          "arn:aws:glue:${var.region}:${local.account_id}:table/workspace_*/*",
        ]
      },
      # Athena reads source data using the caller's identity — the proxy
      # role needs GetObject on the data bucket.
      {
        Sid    = "S3ReadDataForAthena"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetBucketLocation",
        ]
        Resource = [
          aws_s3_bucket.data.arn,
          "${aws_s3_bucket.data.arn}/*",
        ]
      },
      {
        Sid      = "S3ListDataForAthena"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.data.arn
      },
      # Save-to-workspace (issue #11): the proxy copies the result CSV
      # (and optionally a .sql sidecar) from the results bucket into
      # the caller's `users/<username>/...` prefix. IAM permits any
      # path under `users/*`; the proxy's route-layer guard
      # (`parseSaveBody`) enforces that the request's targetKey
      # actually starts with `req.user.s3.prefix`, so one user
      # can't write into another's prefix.
      {
        Sid    = "S3WriteUserWorkspaces"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ]
        Resource = [
          "${aws_s3_bucket.data.arn}/users/*",
        ]
      },
      # Athena writes results using the caller's identity — the proxy role
      # needs RW on the results bucket.
      {
        Sid    = "S3ReadWriteResults"
        Effect = "Allow"
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
        Sid      = "S3ListResults"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.results.arn
      },
    ]
  })
}

# --- Execution role (ECR pull + log writes) ---
resource "aws_iam_role" "proxy_exec" {
  name               = "${local.prefix}-proxy-exec"
  assume_role_policy = data.aws_iam_policy_document.proxy_task_trust.json
}

resource "aws_iam_role_policy_attachment" "proxy_exec_managed" {
  role       = aws_iam_role.proxy_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
