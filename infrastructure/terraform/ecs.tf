# ============================================================================
# ECS Fargate — the proxy runs here.
#
# Task placement:
#   - ahara private subnets (egress via NAT, no public IP)
#   - Dedicated security group; ingress only from the ahara ALB SG on :8080
#
# Image:
#   - Pulled from ECR repo provisioned in ecr.tf, tag `:latest`
#   - Chicken-and-egg: first `terraform apply` creates the task def with a
#     tag that doesn't exist yet; Fargate keeps retrying the pull. Run
#     `scripts/deploy.sh` (which pushes the image + force-new-deployment)
#     to converge.
# ============================================================================

resource "aws_ecs_cluster" "main" {
  name = "${local.prefix}-demo"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "proxy" {
  name              = "/ecs/${local.prefix}-proxy"
  retention_in_days = 7
}

# --- Security group for the task ---
# Ingress: ALB → 8080 only.
# Egress: all (AWS APIs via NAT).
resource "aws_security_group" "proxy_task" {
  name        = "${local.prefix}-proxy-task"
  description = "Fargate task SG for ${local.prefix} proxy"
  vpc_id      = data.aws_vpc.ahara.id
}

resource "aws_security_group_rule" "proxy_task_ingress_alb" {
  type                     = "ingress"
  from_port                = 8080
  to_port                  = 8080
  protocol                 = "tcp"
  security_group_id        = aws_security_group.proxy_task.id
  source_security_group_id = data.aws_security_group.alb.id
  description              = "ALB to proxy :8080"
}

resource "aws_security_group_rule" "proxy_task_egress_all" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  security_group_id = aws_security_group.proxy_task.id
  cidr_blocks       = ["0.0.0.0/0"]
  description       = "All outbound for AWS APIs via NAT"
}

# --- Task definition ---
resource "aws_ecs_task_definition" "proxy" {
  family                   = "${local.prefix}-proxy"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"

  execution_role_arn = aws_iam_role.proxy_exec.arn
  task_role_arn      = aws_iam_role.proxy_task.arn

  container_definitions = jsonencode([
    {
      name      = "proxy"
      image     = local.container_image
      essential = true

      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
          protocol      = "tcp"
        },
      ]

      environment = [
        { name = "PORT", value = "8080" },
        { name = "AWS_REGION", value = var.region },

        # FUTURE (proxy code delta): the proxy currently reads MOCK_AUTH or
        # X-Mock-User. After the app-code update lands, it reads the ALB
        # headers — signal which mode to use via AUTH_PROVIDER.
        { name = "AUTH_PROVIDER", value = "alb" },
        { name = "MOCK_AUTH", value = "0" },

        { name = "COGNITO_USER_POOL_ID", value = local.user_pool_id },
        { name = "COGNITO_CLIENT_ID", value = aws_cognito_user_pool_client.app.id },
        { name = "COGNITO_IDENTITY_POOL_ID", value = aws_cognito_identity_pool.main.id },
        { name = "COGNITO_ISSUER", value = local.cognito_issuer },
        { name = "COGNITO_JWKS", value = local.cognito_jwks },
        { name = "COGNITO_DOMAIN", value = local.cognito_domain },

        # Per-user Athena workgroup + S3 prefix are derived deterministically
        # from the `cognito:username` claim — no DynamoDB lookup required.
        # Proxy builds: workgroup=${NAME_PREFIX}-${username},
        #              prefix=users/${username}/,
        #              roleArn=arn:aws:iam::${AWS_ACCOUNT_ID}:role/${NAME_PREFIX}-user-${username}
        { name = "AWS_ACCOUNT_ID", value = local.account_id },
        { name = "NAME_PREFIX", value = local.prefix },
        { name = "DATA_BUCKET", value = aws_s3_bucket.data.id },
        { name = "RESULTS_BUCKET", value = aws_s3_bucket.results.id },
        { name = "GLUE_DATABASE", value = aws_glue_catalog_database.main.name },
        { name = "PUBLIC_HOSTNAME", value = local.hostname },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.proxy.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "proxy"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -qO- http://localhost:8080/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    },
  ])
}

# --- Service ---
resource "aws_ecs_service" "proxy" {
  name            = "${local.prefix}-proxy"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.proxy.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = data.aws_subnets.private.ids
    security_groups  = [aws_security_group.proxy_task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.proxy.arn
    container_name   = "proxy"
    container_port   = 8080
  }

  # Listener rules must exist before Fargate registers targets.
  depends_on = [
    aws_lb_listener_rule.api,
    aws_lb_listener_rule.spa,
  ]

  lifecycle {
    # Don't fight an operator who scales via the console; ignore count drift.
    ignore_changes = [desired_count]
  }
}
