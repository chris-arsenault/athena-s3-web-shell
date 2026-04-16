output "hostname" {
  description = "Public URL the SPA is served at (https)."
  value       = local.hostname
}

output "cognito_user_pool_id" {
  description = "ahara User Pool ID that this stack attached to."
  value       = local.user_pool_id
}

output "cognito_app_client_id" {
  description = "athena-shell app client ID — feed to the SPA and the proxy."
  value       = aws_cognito_user_pool_client.app.id
}

output "cognito_identity_pool_id" {
  description = "Identity Pool ID — the SPA exchanges JWT here for browser-direct S3 creds."
  value       = aws_cognito_identity_pool.main.id
}

output "cognito_domain" {
  description = "Hosted UI domain, e.g. auth.services.ahara.io"
  value       = local.cognito_domain
}

output "cognito_issuer" {
  description = "OIDC issuer URL — used by ALB jwt-validation action and SPA PKCE flow."
  value       = local.cognito_issuer
}

output "data_bucket" {
  description = "S3 bucket holding user workspaces under users/<username>/."
  value       = aws_s3_bucket.data.id
}

output "results_bucket" {
  description = "S3 bucket holding Athena query results under users/<username>/."
  value       = aws_s3_bucket.results.id
}

output "glue_database" {
  description = "Glue catalog database used for Athena table definitions."
  value       = aws_glue_catalog_database.main.name
}

output "user_workgroups" {
  description = "Per-user Athena workgroup names."
  value       = { for u, wg in aws_athena_workgroup.user : u => wg.name }
}

output "user_roles" {
  description = "Per-user IAM role ARNs assumable via Cognito Identity Pool."
  value       = { for u, r in aws_iam_role.test_user : u => r.arn }
}

output "ecr_repository_url" {
  description = "ECR repo for the proxy image. Deploy script pushes here."
  value       = aws_ecr_repository.proxy.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.proxy.name
}

output "cloudtrail_bucket" {
  description = "Bucket holding S3 CloudTrail data-event logs. Query with Athena over the AWSLogs/<acct>/CloudTrail/ prefix."
  value       = aws_s3_bucket.cloudtrail.id
}

output "cloudtrail_name" {
  description = "CloudTrail trail name. Enabled on the data + results buckets for object-level audit."
  value       = aws_cloudtrail.s3_data_events.name
}

# ============================================================================
# Secrets — sensitive; retrieve with `terraform output -json test_user_passwords`
# ============================================================================

output "test_users" {
  description = "Usernames + emails. Pair with `test_user_passwords` to log in."
  value = {
    for name, user in aws_cognito_user.test :
    name => {
      username = user.username
      email    = user.attributes["email"]
    }
  }
}

output "test_user_passwords" {
  description = "Permanent passwords for the test users. Retrieve with: terraform output -json test_user_passwords"
  value = {
    for name, pw in random_password.test_user : name => pw.result
  }
  sensitive = true
}
