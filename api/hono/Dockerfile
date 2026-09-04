# syntax=docker/dockerfile:1
FROM oven/bun:1.4.1-alpine AS base
WORKDIR /app

FROM base AS prepare
COPY . .
RUN bunx turbo prune @api/hono --docker

FROM base AS builder
COPY --from=prepare /app/.github/scripts .github/scripts
COPY --from=prepare /app/out/json/ .
RUN bun install --frozen-lockfile --ignore-scripts
COPY --from=prepare /app/out/full/ .
RUN --mount=type=secret,id=dotenv,target=/app/.env,required=true bunx turbo run build --filter=@api/hono --force

FROM base AS runner
WORKDIR /app/api/hono
COPY --from=builder --chown=bun:bun /app/api/hono/bundle ./bundle

# See api/hono/src/routers/metrics.ts: the bundled runtime lives one directory shallower than
# unbundled source, so the same fixed "../../../../ " would resolve outside the image entirely.
# docker-compose.yml bind-mounts ./data read-only to this same path.
ENV METRICS_DATA_DIR=/app/data

USER bun
CMD ["bun", "bundle/index.mjs"]
EXPOSE 4000
