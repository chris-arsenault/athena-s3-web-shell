# ============================================================================
# Cognito App Client — public SPA client with Hosted UI + PKCE.
#
# Attached to the existing ahara-users User Pool (discovered via SSM).
# No client secret — PKCE provides security for a public client.
#
# FUTURE (SSO): Federate to Entra. Uncomment the aws_cognito_identity_provider
# block below and add "Entra" to supported_identity_providers on the client.
# When federated, test users (users.tf) go away — they're provisioned on
# first login via SSO.
# ============================================================================

resource "aws_cognito_user_pool_client" "app" {
  name         = "${local.prefix}-app"
  user_pool_id = local.user_pool_id

  generate_secret = false

  # Hosted UI + PKCE — the SPA initiates this via oidc-client-ts.
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = ["https://${local.hostname}/auth/callback"]
  logout_urls                          = ["https://${local.hostname}"]
  default_redirect_uri                 = "https://${local.hostname}/auth/callback"

  supported_identity_providers = ["COGNITO"]
  # FUTURE (SSO): supported_identity_providers = ["COGNITO", "Entra"]

  # Explicit auth flows are for the non-hosted-UI path (admin-initiated,
  # SPA-SDK-direct). Needed so the ALB / SDK can refresh tokens server-side.
  explicit_auth_flows = [
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # Short-lived access/ID tokens, longer refresh. Demo defaults; production
  # would tune based on idle/absolute session policy.
  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

# ============================================================================
# FUTURE (SSO): Entra federation.
#
# Uncomment, set the variables (pull from Secrets Manager / SSM), and add
# "Entra" to supported_identity_providers on the client above. The rest of
# the stack (Identity Pool rule mappings, IAM role trust policies) stays
# unchanged — Cognito's `sub` claim still keys everything.
#
# Two shapes:
#
#   SAML:
#     provider_type = "SAML"
#     provider_details = {
#       MetadataURL             = "https://login.microsoftonline.com/<tenant>/federationmetadata/..."
#       IDPSignout              = "true"
#       EncryptedResponses      = "false"
#       RequestSigningAlgorithm = "rsa-sha256"
#     }
#
#   OIDC:
#     provider_type = "OIDC"
#     provider_details = {
#       client_id                 = "<entra-app-reg-client-id>"
#       client_secret             = "<entra-client-secret>"
#       authorize_scopes          = "openid email profile"
#       oidc_issuer               = "https://login.microsoftonline.com/<tenant>/v2.0"
#       attributes_request_method = "GET"
#     }
# ============================================================================
#
# resource "aws_cognito_identity_provider" "entra" {
#   user_pool_id  = local.user_pool_id
#   provider_name = "Entra"
#   provider_type = "SAML"
#
#   provider_details = {
#     MetadataURL        = var.entra_metadata_url
#     IDPSignout         = "true"
#     EncryptedResponses = "false"
#   }
#
#   attribute_mapping = {
#     email    = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
#     username = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"
#   }
# }
