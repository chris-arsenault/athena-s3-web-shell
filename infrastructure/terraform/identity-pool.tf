# ============================================================================
# Cognito Identity Pool — the credential broker.
#
# Browser flow:
#   1. SPA completes Hosted UI + PKCE → holds an ID token (JWT).
#   2. SPA calls GetCredentialsForIdentity(identity_pool_id, ID token) via
#      @aws-sdk/credential-providers' fromCognitoIdentityPool. Identity Pool
#      internally calls AssumeRoleWithWebIdentity against the per-user role
#      selected by rule-based mapping below.
#   3. SPA uses the returned STS creds with @aws-sdk/client-s3 directly —
#      no proxy involvement for S3 ops.
#
# This is the "Identity Pool pattern" — the proxy never handles STS.
#
# FUTURE (SSO): With Entra federation, the rule-based mapping below switches
# from matching on `cognito:username` to matching on `cognito:groups` (or an
# Entra-provided group claim via SAML attribute mapping). Each group maps to
# a team-level role rather than per-user roles.
# ============================================================================

resource "aws_cognito_identity_pool" "main" {
  identity_pool_name               = "${local.prefix}-identity"
  allow_unauthenticated_identities = false

  cognito_identity_providers {
    client_id               = aws_cognito_user_pool_client.app.id
    provider_name           = "cognito-idp.${var.region}.amazonaws.com/${local.user_pool_id}"
    server_side_token_check = false
  }
}

resource "aws_cognito_identity_pool_roles_attachment" "main" {
  identity_pool_id = aws_cognito_identity_pool.main.id

  # Fallback role — used for authenticated users with no matching rule.
  # Granted zero permissions (see iam-user-roles.tf) so unmapped users can
  # authenticate but can't access any AWS resource.
  roles = {
    authenticated = aws_iam_role.fallback_authenticated.arn
  }

  role_mapping {
    identity_provider         = "cognito-idp.${var.region}.amazonaws.com/${local.user_pool_id}:${aws_cognito_user_pool_client.app.id}"
    ambiguous_role_resolution = "Deny"
    type                      = "Rules"

    # One rule per test user. `cognito:username` is the username claim as it
    # appears in the Cognito ID token.
    #
    # FUTURE (SSO): replace with a single groups-based rule like:
    #   claim      = "cognito:groups"
    #   match_type = "Contains"
    #   value      = "athena-shell-analysts"
    #   role_arn   = aws_iam_role.team_member.arn
    dynamic "mapping_rule" {
      for_each = local.user_set
      content {
        claim      = "cognito:username"
        match_type = "Equals"
        value      = mapping_rule.value
        role_arn   = aws_iam_role.test_user[mapping_rule.value].arn
      }
    }
  }
}
