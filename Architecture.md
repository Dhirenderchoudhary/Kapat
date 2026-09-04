# Architecture

AI Risk Manager: detect coordinated fraud rings, verify borderline groups by voice, leave every money movement to a named merchant.

The AI layers produce evidence. They do not capture, refund, or cancel. A `merchant_decisions` row or a hold release/reject is the only executor input. If a hold is forgotten, Razorpay expires the authorization and the customer is refunded.

```
ingest (webhook / CSV / demo)
        │
        ▼
 Postgres  accounts, transactions, account_links, clusters,
           verifications, merchant_decisions, payment_holds, audit_log
        │
        ▼
 POST /api/clusters/detect
        ├─ HTTP to services/detector-service  (Python Louvain; published metrics)
        └─ api/hono/src/lib/detector.ts       (TypeScript Louvain; serverless)
        │
        ▼
 dashboard  web/next
        │
        ├─ voice  Sarvam TTS/STT, asks only
        └─ human  freeze cluster / capture hold / refund hold
```

## Repository layout

```
api/hono/                 Hono API (Bun). Routers, TS detector, Sarvam, Razorpay
web/next/                 Next.js console + fumadocs
packages/db/              Drizzle schema and migrations
packages/env/             Typed env. Fail closed if required vars are missing
packages/auth/            Better Auth
services/detector-service Python FastAPI detector
services/verifier-service Python parser + optional call harness
data/                     Synthetic datasets and measured JSON
tests/                    Bun tests (TS) and Python unittest
docs/                     Algorithm and API write-ups
```

There is no `apps/web` or `apps/api`. Older comments that say those paths mean `web/next` and `api/hono`.

## Detector

Python (`services/detector-service`) is the engine every number in `data/*.json` was measured on.

| Module              | Job                                                             |
| ------------------- | --------------------------------------------------------------- |
| `graph_builder.py`  | Account graph. Five labeled edge types, never an unlabeled link |
| `clustering.py`     | Louvain (`networkx.louvain_communities`, seed 42)               |
| `cluster_scorer.py` | Corroboration-gated risk, benign ceiling 0.40                   |
| `model_scorer.py`   | Optional hybrid (heuristic score + random forest)               |
| `main.py`           | FastAPI `POST /detect-rings`, `GET /model`                      |

TypeScript (`api/hono/src/lib/detector.ts`) is the same signal derivation and a Louvain port for deploys without the sidecar. It visits nodes in sorted order instead of Python's shuffled seed. Community identity vs Python:

- `detector_test.json` 12/12
- `hard_test.json` 131/131
- `hard_train.json` 200/209 (densest graph; 9 differ)

`POST /api/clusters/detect` always returns `engine` (`detector-service` | `typescript-fallback`) and `clusteringMethod` (`louvain` | `connected_components`). Published precision and recall describe the Python path only.

Why not a GNN: labeled ring volume and calendar. Louvain on an explicit signal graph is explainable (every edge has `signal_type` and `confidence`) and is what this build ships.

## Verifier and voice

Python `response_parser.py` is keyword banks, longest-match-first, one shared span across confirm / deny / hedge. Outcomes: `confirmed_linked`, `denied_linked`, `unclear`, `no_response`. Confirming a **linked account** leans household. Denying it strengthens the ring hypothesis.

Live audio is Hono, not the Python service:

- `POST /api/voice/speak` Sarvam Bulbul v3
- `POST /api/voice/listen` Sarvam Saaras v3, then the same rule parse

The merchant script asks cancel vs release. It does not call Razorpay. Missing `SARVAM_API_KEY` returns `VOICE_NOT_CONFIGURED`.

## Holds

Razorpay manual capture. On `payment.authorized` the agent **does not capture**. A `payment_holds` row is the waiting room (up to ~3 days).

- Release → `POST /v1/payments/:id/capture` (only capture in this codebase)
- Reject → refund
- Ignore → Razorpay auto-refunds the customer

`expires_at` is taken from authorization time, not webhook arrival.

## Dashboard

Next.js App Router in `web/next/src/app`. Browser talks to `/api` on the site origin or to `NEXT_PUBLIC_API_URL`. The Next server uses `INTERNAL_API_URL` when the public API origin is the website itself, so the rewrite cannot loop. No production host is hardcoded.

Screens: [`Design.md`](Design.md).

## Data model

Logical tables (Drizzle in `packages/db/src/schema/fraud.ts` and `holds.ts`):

- `accounts` unique `customer_ref`
- `transactions` unique `razorpay_event_id`
- `account_links` unique (a, b, `signal_type`); `signal_type` and `confidence` required
- `clusters` + `cluster_members`
- `verifications`
- `merchant_decisions` (`reason` required when `action = dismiss`, CHECK constraint)
- `audit_log` jsonb payload per cluster event
- `payment_holds` unique `razorpay_payment_id`; decided rows require `decided_by`

Better Auth's `account` table is OAuth links for console users. Fraud `accounts` are graph nodes. Different tables, same English word.

## HTTP

Prefix `/api` except `POST /webhooks/razorpay`. CORS from `HONO_TRUSTED_ORIGINS`. Rate limit `HONO_RATE_LIMIT`. OpenAPI at `/api/openapi.json`.

See [`docs/api.md`](docs/api.md).

## Environment

Hosts and secrets come from env. They are not compiled into source.

| Variable                  | Who reads it                                          |
| ------------------------- | ----------------------------------------------------- |
| `POSTGRES_URL`            | API, migrations                                       |
| `NEXT_PUBLIC_APP_URL`     | Site origin (build-time for the browser bundle)       |
| `NEXT_PUBLIC_API_URL`     | Browser API origin. One URL, not a comma list         |
| `INTERNAL_API_URL`        | Next server → Hono when the public API is same-origin |
| `HONO_APP_URL`            | API self URL                                          |
| `HONO_WEB_URL`            | Console origin                                        |
| `HONO_TRUSTED_ORIGINS`    | CORS allow list (comma-separated)                     |
| `SARVAM_API_KEY`          | Voice. Optional                                       |
| `RAZORPAY_CREDENTIAL_KEY` | Encrypt merchant secrets at rest                      |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signatures (not the API key secret)           |
| `DETECTOR_SERVICE_URL`    | Compose / sidecar. Unset → TypeScript fallback        |

`.env.example` is localhost only. Production values belong on the host (Vercel or similar), not in git.

## Local orchestration

`bun run dev` runs `web/next` and `api/hono` via turbo.

`docker compose up` runs Postgres 16, API, detector-service, and the web image. Compose overrides `POSTGRES_URL` and `DETECTOR_SERVICE_URL` onto the compose network so the API does not talk to a shared cloud database by accident.

## Principles the schema actually enforces

1. No autonomous money movement.
2. One audit record covering evidence → verification → decision → execution.
3. Idempotency is a unique index, not an `if` in application code.
4. Edges are labeled. Dismiss and hold-reject require a reason / decider.
5. Metrics that were not measured are omitted, not invented as rupees.
