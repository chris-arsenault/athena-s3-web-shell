# ============================================================================
# DNS — single A-ALIAS record pointing shell.ahara.io at the shared ALB.
# No new domain registered; consumes the existing ahara.io zone.
# ============================================================================

resource "aws_route53_record" "shell" {
  zone_id = data.aws_route53_zone.ahara.zone_id
  name    = local.hostname
  type    = "A"

  alias {
    name                   = data.aws_lb.ahara.dns_name
    zone_id                = data.aws_lb.ahara.zone_id
    evaluate_target_health = true
  }
}
