# ============================================================================
# ahara pre-auth Lambda integration.
#
# The ahara platform runs a pre-auth Lambda trigger on the shared Cognito
# User Pool. It rejects any login where either:
#   (a) the incoming client_id isn't registered in /ahara/auth-trigger/client-map
#   (b) the username isn't listed in the `ahara-user-access` DynamoDB table
#       with access to the right app
#
# Both failures surface as Cognito's generic "PreAuthentication failed"
# error — specifically "Unknown application: <client-id>" for (a) and
# "Access denied" for (b).
#
# Two things this file provisions:
#   1. /ahara/auth-trigger/clients/athena-shell SSM param → registers our
#      client ID for the consolidated map.
#   2. ahara-user-access DynamoDB rows → grants each test user access to
#      the athena-shell app.
#
# PROPAGATION NOTE: step 1 alone isn't sufficient — ahara-infra's own
# terraform apply reads all /ahara/auth-trigger/clients/* entries and
# regenerates /ahara/auth-trigger/client-map. After applying this stack,
# run `terraform apply` in /home/tsonu/src/ahara-infra so the consolidated
# map picks up our entry. Warm Lambda containers cache the map for up to
# ~15 min, so expect a short propagation delay.
# ============================================================================

# --- Step 1: register our Cognito client with the pre-auth Lambda ---
resource "aws_ssm_parameter" "auth_trigger_registration" {
  name        = "/ahara/auth-trigger/clients/${local.prefix}"
  type        = "String"
  value       = aws_cognito_user_pool_client.app.id
  description = "Registers athena-shell's Cognito app client with the ahara pre-auth trigger."
}

# --- Step 2: grant test users access to the athena-shell app ---
# Table `ahara-user-access` is owned by ahara-infra (see
# /home/tsonu/src/ahara-infra/infrastructure/terraform/services/identity.tf).
# We just write rows to it.
#
# The pre-auth Lambda uses `event.userName` as the DynamoDB key, which is
# the Cognito primary username (not the email). Our test users are created
# with plain usernames like `test_athena_1`, so that's what we key on.
#
# The `apps` map value is a freeform role string — the Lambda just checks
# for the key, it doesn't validate the role. We write "user" for clarity.
#
# FUTURE (SSO): under Entra federation, users are created on first login
# via SAML and their Cognito username will typically be their email. This
# for_each block disappears; access provisioning moves into Entra groups.
resource "aws_dynamodb_table_item" "user_access" {
  for_each = local.user_set

  table_name = "ahara-user-access"
  hash_key   = "username"

  item = jsonencode({
    username = { S = each.value }
    apps = {
      M = {
        (local.prefix) = { S = "user" }
      }
    }
  })
}
