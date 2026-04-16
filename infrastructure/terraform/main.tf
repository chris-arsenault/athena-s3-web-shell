# ============================================================================
# athena-shell demo — IaC entrypoint
#
# This stack provisions the AWS resources needed to run the athena-shell
# SPA + proxy in the ahara AWS account as a short-term demo. It deliberately
# does NOT reuse the ahara-tf-patterns modules (platform-context, cognito-app,
# alb-api) — every resource is spelled out here so the demo / SSO replacement
# surfaces are readable in-file.
#
# Discovery-via-tags (VPC, ALB, subnets, SG) follows ahara conventions; see
# data.tf.
#
# Every "# FUTURE (SSO): ..." comment below marks a replacement point for
# transition to a real Entra-federated production environment.
# ============================================================================

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "athena-shell"
      ManagedBy = "Terraform"
      Demo      = "true"
    }
  }
}
