# ============================================================================
# Platform discovery — ahara's VPC, ALB, Cognito pool.
#
# Tag-based lookups (vpc:role, subnet:access, lb:role, sg:role) follow the
# ahara convention so this stack survives platform resource replacement
# without a terraform apply.
#
# Cognito pool data is in SSM params under /ahara/cognito/*, published by
# ahara-infra services module.
# ============================================================================

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

# --- VPC + subnets ---
data "aws_vpc" "ahara" {
  tags = {
    "vpc:role" = "ahara"
  }
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.ahara.id]
  }
  tags = {
    "subnet:access" = "private"
  }
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.ahara.id]
  }
  tags = {
    "subnet:access" = "public"
  }
}

# --- ALB + HTTPS listener ---
data "aws_lb" "ahara" {
  tags = {
    "lb:role" = "ahara"
  }
}

data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.ahara.arn
  port              = 443
}

# The ALB's own security group — we add an ingress from it to our Fargate SG
# so ALB can reach the container port.
data "aws_security_group" "alb" {
  vpc_id = data.aws_vpc.ahara.id

  filter {
    name   = "tag:sg:role"
    values = ["alb"]
  }
  filter {
    name   = "tag:sg:scope"
    values = ["public"]
  }
}

# --- Cognito pool (authoritative source) ---
data "aws_ssm_parameter" "cognito_user_pool_id" {
  name = "/ahara/cognito/user-pool-id"
}

data "aws_ssm_parameter" "cognito_user_pool_arn" {
  name = "/ahara/cognito/user-pool-arn"
}

data "aws_ssm_parameter" "cognito_domain" {
  name = "/ahara/cognito/domain"
}

data "aws_ssm_parameter" "cognito_issuer_url" {
  name = "/ahara/cognito/issuer-url"
}

# --- Route53 zone ---
data "aws_route53_zone" "ahara" {
  name         = "${var.ahara_zone_name}."
  private_zone = false
}
