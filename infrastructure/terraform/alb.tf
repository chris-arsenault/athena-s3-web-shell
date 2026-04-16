# ============================================================================
# ALB integration — we attach two listener rules to the ahara shared ALB's
# HTTPS listener (discovered in data.tf).
#
#   Priority 220: shell.ahara.io/api/*  → Fargate, jwt-validation action
#   Priority 221: shell.ahara.io/*      → Fargate, unauthenticated (SPA)
#
# Rule priorities are globally unique on the listener; ahara consumers own:
#   - dosekit     : 201
#   - tastebase   : 210-214
#   - athena-shell: 220-221  (this stack)
#   - svap        : 300-302
#
# The SPA owns its own Hosted UI + PKCE flow (via oidc-client-ts, NOT
# Amplify); ALB's jwt-validation validates the bearer token on /api/*
# requests and injects x-amzn-oidc-identity + x-amzn-oidc-data headers.
# ============================================================================

# --- ACM certificate for shell.ahara.io ---
resource "aws_acm_certificate" "main" {
  domain_name       = local.hostname
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id         = data.aws_route53_zone.ahara.zone_id
  name            = each.value.name
  type            = each.value.type
  ttl             = 60
  records         = [each.value.record]
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# Attach the cert to the shared ahara HTTPS listener. ALB selects it via SNI.
resource "aws_lb_listener_certificate" "main" {
  listener_arn    = data.aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate_validation.main.certificate_arn
}

# --- Target group — Fargate tasks register by IP (awsvpc networking) ---
resource "aws_lb_target_group" "proxy" {
  name        = "${local.prefix}-proxy"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.ahara.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    protocol            = "HTTP"
  }

  deregistration_delay = 15

  # Force re-create if the target protocol/port ever changes — ALB target
  # groups are immutable on those dimensions.
  lifecycle {
    create_before_destroy = true
  }
}

# --- Listener rule #1: /api/* → Fargate, JWT-validated ---
#
# The SPA includes `Authorization: Bearer <id_token>` on every /api/* call.
# ALB validates signature + issuer + audience + expiry against Cognito's
# JWKS, then forwards to the target group with claim-mapping headers:
#   - x-amzn-oidc-identity : sub (the user's Cognito UUID)
#   - x-amzn-oidc-data     : validated JWT, re-signed by ALB
#
# The proxy reads these headers to identify the user (see ecs.tf env).
#
# FUTURE (SSO): When federating to Entra, the issuer stays on Cognito (which
# is still between the SPA and Entra). No ALB config change needed.
resource "aws_lb_listener_rule" "api" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = var.alb_priority_api

  condition {
    host_header {
      values = [local.hostname]
    }
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  action {
    type = "jwt-validation"

    # NOTE: aws provider 6.41 exposes only issuer + jwks_endpoint on this
    # block today. The ALB API supports Audience + OnFailure + ClaimsMapping
    # (JwtValidationConfig in the AWS spec) — if/when the provider adds
    # them, tighten here so the audience check happens at the edge.
    # Until then the proxy re-checks `aud` against COGNITO_CLIENT_ID on its
    # own after reading x-amzn-oidc-data.
    jwt_validation {
      issuer        = local.cognito_issuer
      jwks_endpoint = local.cognito_jwks
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.proxy.arn
  }
}

# --- Listener rule #2: /* (SPA + auth callback) — unauthenticated ---
#
# Serves static SPA assets and the /auth/callback landing. The SPA itself
# handles the Hosted UI redirect; it uses oidc-client-ts to:
#   1. Build the authorize URL (with PKCE code_challenge)
#   2. Redirect to Cognito domain
#   3. On /auth/callback, exchange code+verifier for tokens
#   4. Use the ID token for /api/* and for the Identity Pool exchange
resource "aws_lb_listener_rule" "spa" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = var.alb_priority_spa

  condition {
    host_header {
      values = [local.hostname]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.proxy.arn
  }
}
