# Running it locally

Three processes and a database. The Next console talks to the Hono API, the Hono API talks to the
Python detector over HTTP, and everything reads and writes one Postgres.

```
web/next  :3000  ──▶  api/hono  :4000  ──▶  detector-service  :8001
                          │
                          ▼
                     Postgres :5432
```

`DETECTOR_SERVICE_URL` defaults to `http://localhost:8001`. If the detector is not running, the API
falls back to a TypeScript reimplementation of the same algorithm and says so in the response's
`fallbackReason`, so a missing sidecar degrades rather than fails.

---

## 1. Node side

```bash
bun install
cp .env.example .env
```

`.env.example` is localhost only. Production values belong on the host, never in git.

## 2. Database

Any Postgres 16+ works. Point `POSTGRES_URL` at it, then:

```bash
bun run db:migrate
```

Migrations under `packages/db/drizzle/` are hand-written SQL, not drizzle-kit generated, because
drizzle-kit could not run in the environment they were authored in. Follow that pattern when adding
one.

If you have no Postgres to hand, a throwaway instance is enough for everything including the tests:

```bash
initdb -D /tmp/rzpg-data -U verify --auth=trust
pg_ctl -D /tmp/rzpg-data -o "-p 5432" -l /tmp/rzpg.log start
createdb -h 127.0.0.1 -p 5432 -U verify razorpay
```

`docker compose up` also brings up Postgres 16, the API, the detector and the web image together.
Compose overrides `POSTGRES_URL` and `DETECTOR_SERVICE_URL` onto its own network so the API cannot
accidentally talk to a shared cloud database.

## 3. Python services

The two Python services are not in the Bun workspace and are not installed by `bun install`. On any
recent Python, install into a virtualenv rather than the system interpreter:

```bash
python3 -m venv .venv
.venv/bin/pip install -r services/detector-service/requirements.txt
.venv/bin/pip install -r services/verifier-service/requirements.txt
```

The runtime detector needs only `networkx` and `fastapi`. The offline analysis scripts
(`train_model.py`, `make_figures.py`) additionally need
`services/detector-service/requirements-analysis.txt`, which pins scikit-learn, numpy and matplotlib
to exact versions. That is deliberate: the model comparison numbers are only reproducible against a
fixed scikit-learn, and an open `>=` floor previously let one model's reported precision drift while
the docs still quoted the old figure.

Start the detector:

```bash
cd services/detector-service
../../.venv/bin/python -m uvicorn main:app --port 8001
```

It exposes `GET /health`, `GET /model` and `POST /detect-rings`. `GET /model` reports which scorer is
live, the operating threshold, and whether the running scikit-learn matches the one the model was
pickled under.

## 4. The app

```bash
bun run dev:local
```

**Use `dev:local`, not `dev`.** `bun run dev` goes through portless, which assigns random ports and
`.localhost` hostnames while `.env` hardcodes `localhost:4000`. That mismatch shows up as "Network
request failed" on every page and has cost hours more than once. If you do want portless, resolve the
URLs with `bunx portless get`.

---

## Seeding data worth looking at

`seed_demo_data.py` inserts raw accounts and transactions and nothing else. It deliberately does not
compute clusters: the detect endpoint is the one place raw rows become clusters, and it goes through
the real service over HTTP, so seeding this way exercises the live agent rather than bypassing it.

```bash
POSTGRES_URL=... .venv/bin/python services/detector-service/seed_demo_data.py
curl -X POST http://localhost:4000/api/clusters/detect \
  -H 'content-type: application/json' -d '{}'
```

A successful run reports `engine: "detector-service"` and `fallbackReason: null`. If it reports the
fallback engine instead, the sidecar is not reachable.

## Exercising the webhook

The webhook verifies an HMAC-SHA256 of the **raw body** using `RAZORPAY_WEBHOOK_SECRET`, before
parsing the JSON. With the secret unset it returns 503 and refuses the payload rather than accepting
an unverified write into the fraud graph.

```bash
SECRET=whsec_your_test_secret
BODY='{"event":"payment.authorized","payload":{"payment":{"entity":{
  "id":"pay_demo_001","amount":250000,"created_at":1767200000,
  "email":"a@example.in","contact":"+919900000001",
  "card":{"id":"card_demo"},"notes":{"address":"1 Demo St","promo_code":"WELCOME50"}}}}}'

curl -X POST http://localhost:4000/webhooks/razorpay \
  -H 'content-type: application/json' \
  -H "X-Razorpay-Signature: $(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')" \
  -d "$BODY"
```

A redelivery of the same event returns `ingested: false` and creates nothing. Only
`payment.authorized` is holdable: an authorised payment has funds reserved but not settled, and
Razorpay auto-refunds it after three days if nobody captures. A `payment.captured` event has already
settled, and the agent will not reach for a refund to simulate a hold.

An account's first-ever payment will not be held. It has no relationships in the graph yet, so there
is nothing to detect. That is the cold-start limit, and it is measured rather than hidden.

---

## Environment variables that change behaviour

| Variable                  | Effect when unset                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_URL`            | API will not start; DB-backed tests skip                                                                       |
| `RAZORPAY_WEBHOOK_SECRET` | `POST /webhooks/razorpay` returns 503 and accepts nothing                                                      |
| `DETECTOR_SERVICE_URL`    | Detection falls back to the TypeScript engine, and reports it                                                  |
| `SARVAM_API_KEY`          | `/api/voice/*` cannot synthesize or transcribe                                                                 |
| `RAZORPAY_CREDENTIAL_KEY` | Merchant credentials cannot be encrypted; connect refuses                                                      |
| `RAZORPAY_KEY_ID/SECRET`  | Checkout and subscriptions return 503; hold release/reject records honestly that no capture or refund happened |
| `RAZORPAY_PLAN_ID`        | Subscribe creates a new ₹500 / month plan on Razorpay each time. Set this to reuse one plan.                   |

Every one of these degrades loudly. None of them silently pretends to work.

## Traps worth knowing before you hit them

- **Server-to-client function props throw.** Next cannot serialise a function across that boundary,
  so passing something like `valueLabel={(v) => ...}` from a server page into a client chart takes the
  page down with an error boundary. Every chart prop is a pre-formatted string for this reason.
- **`node --experimental-strip-types` rejects TS transforms**, not merely unsupported syntax.
  Constructor parameter properties fail, which is why `RazorpayError` uses an explicit field.
- **`turbo.json` is JSONC.** Patch it as text; a JSON parser chokes on the comments.
- **matplotlib bakes text into paths**, so one SVG cannot recolour its labels for dark mode. That is
  why `make_figures.py` renders a light and a dark variant, and why the app draws its own charts
  instead of shipping the images.
- **`NODE_ENV=production` in `.env` forces SSL on every database connection.** Pointing at a local
  Postgres container without overriding `NODE_ENV` fails with a TLS error that reads like a network
  fault. Prefix local runs with `NODE_ENV=development`.
- **The browser talks to the API cross-origin.** A local API needs
  `HONO_TRUSTED_ORIGINS` set to the web origin or every client call fails while SSR keeps working.
  The root `.env` `POSTGRES_URL` is the shared Neon instance canary and production both read. Do not
  migrate or seed against it.
