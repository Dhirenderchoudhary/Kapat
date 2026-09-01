# syntax=docker/dockerfile:1
# Build context is the repo root (docker-compose.yml: context: .), so every COPY below is
# repo-root-relative - same convention as api/hono/Dockerfile and web/next/Dockerfile.
FROM python:3.12-slim AS base
WORKDIR /app/services/verifier-service

FROM base AS builder
COPY services/verifier-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM builder AS runner
COPY services/verifier-service/ .
EXPOSE 8002
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002"]
