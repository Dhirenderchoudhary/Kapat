# HTTP API

Hono app in `api/hono`. Browser and OpenAPI clients use the `/api` prefix. Razorpay webhook senders hit `/webhooks/razorpay` at the process root so dashboard routing is not part of the ingest contract.

Live spec: `GET /api/openapi.json`. UI: `GET /api/docs` (feature `apiDocs`).

JSON envelope: `{ "data": ... }` on success. Errors use `{ "error": { "code", "message" } }` from `api/hono/src/lib/error.ts`.

CORS: `HONO_TRUSTED_ORIGINS`. Rate limit: `HONO_RATE_LIMIT` / window.

## System

| Method | Path          | Notes                                         |
| ------ | ------------- | --------------------------------------------- |
| GET    | `/api/health` | Liveness                                      |
| GET    | `/`           | `{ version, environment }` (no `/api` prefix) |

## Clusters

| Method | Path                         | Notes                                                                                                                                                         |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/clusters`              | Query `status`, `page`, `perPage`. Risk descending                                                                                                            |
| GET    | `/api/clusters/:id`          | Members, labeled edges, verifications, decisions, audit log                                                                                                   |
| POST   | `/api/clusters/detect`       | Run detector on all accounts/transactions in Postgres. Idempotent content-hash ids. Body may be empty. Returns `engine`, `clusteringMethod`, `fallbackReason` |
| POST   | `/api/clusters/:id/decision` | `{ action, reason?, decidedBy }`. `action`: freeze, block, escalate, dismiss. Dismiss requires `reason`. Second final decision: 409                           |

## Holds

| Method | Path                     | Notes                                                                                 |
| ------ | ------------------------ | ------------------------------------------------------------------------------------- |
| GET    | `/api/holds`             | Query `status`. Sweeps expired rows first                                             |
| POST   | `/api/holds/:id/release` | Capture via Razorpay. `{ decidedBy }`. Only capture in this repo                      |
| POST   | `/api/holds/:id/reject`  | Refund. `{ decidedBy, note? }`. Note required on reject in the same spirit as dismiss |

## Ingest

| Method | Path                       | Notes                                                                                                    |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| POST   | `/webhooks/razorpay`       | Signature from `RAZORPAY_WEBHOOK_SECRET`. Unique `razorpay_event_id`. New transaction may trigger detect |
| POST   | `/api/ingest/transactions` | `{ rows: [...] }`. Upsert on `customer_ref` / `razorpay_event_id`. Does not run detect                   |
| POST   | `/api/ingest/demo`         | Bundled `detector_train.json` + `detector_test.json`                                                     |

## Measurement

| Method | Path             | Notes                                                                                              |
| ------ | ---------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/api/metrics`   | Offline JSON from `data/` plus live funnel counts. Missing files are `null` with a note, not zero  |
| GET    | `/api/evidence`  | Detector metrics, stress failures, threshold selection, model comparison, hold-verification report |
| GET    | `/api/analytics` | Live SQL aggregates for `/analysis`                                                                |

## Voice

| Method | Path                | Notes                                                                  |
| ------ | ------------------- | ---------------------------------------------------------------------- |
| GET    | `/api/voice`        | `{ configured }`                                                       |
| POST   | `/api/voice/speak`  | `{ language, role, turn, outcome? }` → WAV base64. Does not move money |
| POST   | `/api/voice/listen` | `{ language, role, audioBase64, mimeType }` → transcript + parse       |

Languages: `en-IN`, `hi-IN`, `mr-IN`. Roles: `merchant`, `customer`. Turns: `opening`, `closing`. Unset `SARVAM_API_KEY`: `VOICE_NOT_CONFIGURED`.

## Razorpay merchant connection

| Method | Path                       | Notes                                                            |
| ------ | -------------------------- | ---------------------------------------------------------------- |
| GET    | `/api/razorpay/status`     | Connected or not                                                 |
| POST   | `/api/razorpay/connect`    | Store key id + encrypted secret. Needs `RAZORPAY_CREDENTIAL_KEY` |
| POST   | `/api/razorpay/sync`       | Pull and detect                                                  |
| POST   | `/api/razorpay/auto-sync`  | Toggle poller (no-op on serverless)                              |
| DELETE | `/api/razorpay/connection` | Drop stored keys                                                 |

## Auth and console (scaffold)

Better Auth under `/api/auth`. Optional GitHub/Google. `AGENT_SIGNIN_ENABLED=true` mounts `POST /api/agents/sign-in-as` for local agent testing only. Admin/waitlist routers exist; the fraud demo does not require them.

## Python sidecar (internal)

Not public. Compose sets `DETECTOR_SERVICE_URL=http://detector-service:8001`.

| Method | Path            | Notes                                  |
| ------ | --------------- | -------------------------------------- |
| POST   | `/detect-rings` | Graph, Louvain, score, optional hybrid |
| GET    | `/model`        | Whether `ring_model.joblib` loaded     |

Verifier FastAPI `/call` remains for the Python harness. The console uses Hono `/api/voice` for live Sarvam.
