# ============================================================================
# Proxy IAM — two roles:
#
#   proxy_task — the identity the container runs as. Intentionally has NO
#     app-level permissions: every AWS call the proxy issues runs under
#     the caller's STS credentials (forwarded via the x-aws-* passthrough
#     headers → passthroughCredentials middleware → per-request SDK
#     clients). If the passthrough ever breaks, the SDK will fall back
#     to this role and AccessDenied — much better than silently reaching
#     AWS resources with a shared service identity.
#
#   proxy_exec — standard ECS execution role: ECR image pull + CloudWatch
#     log writes.
# ============================================================================

# --- Task role (no attached policies) ---
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

# Intentionally no `aws_iam_role_policy` attached. All AWS access is via
# credential passthrough (see iam-user-roles.tf for the actual permissions).

# --- Execution role (ECR pull + log writes) ---
resource "aws_iam_role" "proxy_exec" {
  name               = "${local.prefix}-proxy-exec"
  assume_role_policy = data.aws_iam_policy_document.proxy_task_trust.json
}

resource "aws_iam_role_policy_attachment" "proxy_exec_managed" {
  role       = aws_iam_role.proxy_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
