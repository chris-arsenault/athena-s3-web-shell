locals {
  prefix    = var.prefix
  hostname  = var.hostname
  user_set  = toset(var.test_user_names)
  user_list = var.test_user_names

  # Cognito discovery — pulled from SSM params published by ahara-infra.
  # See data.tf for the data sources.
  user_pool_id   = nonsensitive(data.aws_ssm_parameter.cognito_user_pool_id.value)
  user_pool_arn  = nonsensitive(data.aws_ssm_parameter.cognito_user_pool_arn.value)
  cognito_domain = nonsensitive(data.aws_ssm_parameter.cognito_domain.value)
  cognito_issuer = nonsensitive(data.aws_ssm_parameter.cognito_issuer_url.value)
  cognito_jwks   = "${nonsensitive(data.aws_ssm_parameter.cognito_issuer_url.value)}/.well-known/jwks.json"
  account_id     = data.aws_caller_identity.current.account_id

  # Container image tag is the git sha if available, "latest" otherwise.
  # The deploy script overrides this on push; Terraform tracks the image
  # reference used at apply time.
  container_image = "${aws_ecr_repository.proxy.repository_url}:latest"
}
