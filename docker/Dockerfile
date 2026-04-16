# syntax=docker/dockerfile:1.7

#####################
# Builder stage
#####################
FROM node:20-alpine AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/proxy/package.json packages/proxy/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile=false

COPY . .

# ---------------------------------------------------------------------------
# SPA build-time auth configuration.
#
# Default: "mock" — so `make docker` + `make docker-run` locally produces a
# container that serves a mock-backed SPA (matches the dev `MOCK_AUTH=1`
# flow).
#
# For a real deployment the deploy script (scripts/deploy.sh) passes
# `--build-arg VITE_AUTH_PROVIDER=cognito` along with the five
# VITE_COGNITO_* args sourced from terraform outputs. Missing any of them
# when VITE_AUTH_PROVIDER=cognito makes the SPA throw at module load —
# intentional, as the backstop against "deployed build is silently mock."
# ---------------------------------------------------------------------------
ARG VITE_AUTH_PROVIDER=mock
ARG VITE_COGNITO_REGION=
ARG VITE_COGNITO_USER_POOL_ID=
ARG VITE_COGNITO_CLIENT_ID=
ARG VITE_COGNITO_IDENTITY_POOL_ID=
ARG VITE_COGNITO_DOMAIN=

ENV VITE_AUTH_PROVIDER=${VITE_AUTH_PROVIDER} \
    VITE_COGNITO_REGION=${VITE_COGNITO_REGION} \
    VITE_COGNITO_USER_POOL_ID=${VITE_COGNITO_USER_POOL_ID} \
    VITE_COGNITO_CLIENT_ID=${VITE_COGNITO_CLIENT_ID} \
    VITE_COGNITO_IDENTITY_POOL_ID=${VITE_COGNITO_IDENTITY_POOL_ID} \
    VITE_COGNITO_DOMAIN=${VITE_COGNITO_DOMAIN}

RUN pnpm --filter @athena-shell/shared build \
 && pnpm --filter @athena-shell/web build \
 && pnpm --filter @athena-shell/proxy build

# Produce a flat, production-only node_modules for the proxy + its workspace deps.
RUN pnpm --filter @athena-shell/proxy --prod --legacy deploy /tmp/deploy

#####################
# Runtime stage
#####################
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_DIR=/app/public

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder /tmp/deploy ./
COPY --from=builder /workspace/packages/web/dist ./public

USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["node", "dist/index.js"]
