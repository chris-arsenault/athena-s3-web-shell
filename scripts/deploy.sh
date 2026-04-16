#!/usr/bin/env bash
# ============================================================================
# athena-shell demo — local deploy driver.
#
# Prereqs:
#   - An AWS role/identity active in the shell with:
#       * read+write on s3://tfstate-559098897826/projects/athena-shell.tfstate
#       * Terraform apply scope for athena-shell's resources
#       * ECR push on the athena-shell repo
#       * ECS update-service on the athena-shell-demo cluster
#   - terraform >= 1.12, docker, aws CLI, jq
#
# What it does, in order:
#   1. terraform init + apply  (provisions all AWS resources)
#   2. docker build + push     (pushes the proxy image to ECR)
#   3. ecs update-service --force-new-deployment
#                              (pulls the new image)
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT}/infrastructure/terraform"
REGION="${AWS_REGION:-us-east-1}"
IMAGE_TAG="${IMAGE_TAG:-latest}"

cd "${TF_DIR}"

echo "==> terraform init"
terraform init -input=false

echo "==> terraform apply"
terraform apply -auto-approve -input=false

ECR_URL=$(terraform output -raw ecr_repository_url)
CLUSTER=$(terraform output -raw ecs_cluster_name)
SERVICE=$(terraform output -raw ecs_service_name)
HOST=$(terraform output -raw hostname)
COGNITO_USER_POOL_ID=$(terraform output -raw cognito_user_pool_id)
COGNITO_CLIENT_ID=$(terraform output -raw cognito_app_client_id)
COGNITO_IDENTITY_POOL_ID=$(terraform output -raw cognito_identity_pool_id)
COGNITO_DOMAIN=$(terraform output -raw cognito_domain)
REGISTRY="${ECR_URL%/*}"

# SPA is baked with VITE_AUTH_PROVIDER=cognito for a live deploy — this is
# the backstop against shipping a mock-mode SPA.
echo "==> docker build: ${ECR_URL}:${IMAGE_TAG} (auth=cognito)"
cd "${ROOT}"
docker build \
  -f docker/Dockerfile \
  -t "athena-shell:${IMAGE_TAG}" \
  --build-arg VITE_AUTH_PROVIDER=cognito \
  --build-arg "VITE_COGNITO_REGION=${REGION}" \
  --build-arg "VITE_COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID}" \
  --build-arg "VITE_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}" \
  --build-arg "VITE_COGNITO_IDENTITY_POOL_ID=${COGNITO_IDENTITY_POOL_ID}" \
  --build-arg "VITE_COGNITO_DOMAIN=${COGNITO_DOMAIN}" \
  .

echo "==> docker login to ECR"
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

echo "==> docker push ${ECR_URL}:${IMAGE_TAG}"
docker tag "athena-shell:${IMAGE_TAG}" "${ECR_URL}:${IMAGE_TAG}"
docker push "${ECR_URL}:${IMAGE_TAG}"

echo "==> ecs update-service --force-new-deployment"
aws ecs update-service \
  --cluster "${CLUSTER}" \
  --service "${SERVICE}" \
  --force-new-deployment \
  --region "${REGION}" \
  >/dev/null

# ----------------------------------------------------------------------------
# Watch the rollout until the PRIMARY deployment reports COMPLETED and
# runningCount == desiredCount, or bail on FAILED / timeout.
# ----------------------------------------------------------------------------
echo "==> watching rollout (timeout ${ROLLOUT_TIMEOUT:-600}s)"

ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-600}"
ROLLOUT_INTERVAL="${ROLLOUT_INTERVAL:-10}"
START=${SECONDS}
LAST_SIGNATURE=""

while true; do
  ELAPSED=$((SECONDS - START))

  STATE_JSON=$(aws ecs describe-services \
    --cluster "${CLUSTER}" \
    --services "${SERVICE}" \
    --region "${REGION}" \
    --output json)

  RUNNING=$(jq -r '.services[0].runningCount // 0' <<<"${STATE_JSON}")
  DESIRED=$(jq -r '.services[0].desiredCount // 0' <<<"${STATE_JSON}")
  PENDING=$(jq -r '.services[0].pendingCount // 0' <<<"${STATE_JSON}")
  DEPLOY_COUNT=$(jq -r '.services[0].deployments | length' <<<"${STATE_JSON}")
  PRIMARY_STATE=$(jq -r '.services[0].deployments[] | select(.status=="PRIMARY") | .rolloutState // "?"' <<<"${STATE_JSON}")
  FAILED_COUNT=$(jq -r '[.services[0].deployments[] | select(.rolloutState=="FAILED")] | length' <<<"${STATE_JSON}")

  SIGNATURE="${RUNNING}/${DESIRED} pending=${PENDING} deployments=${DEPLOY_COUNT} primary=${PRIMARY_STATE}"

  # Only print when state changes — less noise, still shows progress.
  if [ "${SIGNATURE}" != "${LAST_SIGNATURE}" ]; then
    printf "    [%4ds] running=%s\n" "${ELAPSED}" "${SIGNATURE}"
    LAST_SIGNATURE="${SIGNATURE}"
  fi

  if [ "${FAILED_COUNT}" != "0" ]; then
    echo
    echo "==> rollout FAILED. Last failed deployment:"
    jq '.services[0].deployments[] | select(.rolloutState=="FAILED")' <<<"${STATE_JSON}"
    echo
    echo "==> recent service events:"
    jq -r '.services[0].events[:10][] | "  \(.createdAt) \(.message)"' <<<"${STATE_JSON}"
    exit 1
  fi

  if [ "${DEPLOY_COUNT}" = "1" ] \
     && [ "${PRIMARY_STATE}" = "COMPLETED" ] \
     && [ "${RUNNING}" = "${DESIRED}" ] \
     && [ "${PENDING}" = "0" ]; then
    echo "==> rollout complete in ${ELAPSED}s."
    break
  fi

  if [ "${ELAPSED}" -ge "${ROLLOUT_TIMEOUT}" ]; then
    echo
    echo "==> timeout after ${ROLLOUT_TIMEOUT}s — current state:"
    jq '.services[0].deployments' <<<"${STATE_JSON}"
    echo
    echo "==> recent service events:"
    jq -r '.services[0].events[:10][] | "  \(.createdAt) \(.message)"' <<<"${STATE_JSON}"
    exit 1
  fi

  sleep "${ROLLOUT_INTERVAL}"
done

echo
echo "==> live at: https://${HOST}"
echo
echo "==> fetch test user passwords:"
echo "    cd ${TF_DIR} && terraform output -json test_user_passwords"
echo
echo "==> IMPORTANT: if this is a first-time deploy (or if you added/renamed"
echo "    the Cognito client), run ahara-infra's terraform apply so the"
echo "    pre-auth Lambda's client-map picks up our registration:"
echo
echo "    cd /home/tsonu/src/ahara-infra/infrastructure/terraform && terraform apply"
echo
echo "    Otherwise login will fail with 'PreAuthentication failed ... Unknown"
echo "    application: <clientId>'. Warm Lambda containers cache the map for"
echo "    up to ~15 min; if you retry too soon you may still see the error."
