# ARCHITECTURE - AI Risk Manager: Fraud Ring Detection Platform

## 1. System overview

```
┌───────────────┐   ┌───────────────────┐   ┌────────────────────┐   ┌───────────────────┐
│  1. DETECTOR   │ ->│  2. VERIFIER        │ ->│  3. DASHBOARD +     │ ->│  4. EXECUTOR        │
│  graph +       │   │  voice, borderline  │   │     DECISION        │   │  + AUDIT            │
│  clustering    │   │  clusters only      │   │  (human decision)   │   │  act + log          │
└───────────────┘   └───────────────────┘   └────────────────────┘   └───────────────────┘
        │                      │                        │                        │
        └──────────────────────┴────────────────────────┴────────────────────────┘
                          Postgres - accounts, transactions, clusters, evidence
```

**Governing rule, unchanged from earlier design:** the AI layers (1 and 2) only produce evidence. Layer 3 is where a human (the merchant) makes the actual decision. Layer 4 only acts on an explicit `merchant_decisions` row. See Rules.md Principle 1.

**Scaffold:** `bunx zerostarter init` - `apps/web` (Next.js dashboard) + `apps/api` (Hono) + Drizzle + Postgres, same as prior planning. Python services live in `services/`, alongside `apps/`, per the earlier established convention.

---

## 2. Components

### 2.1 Detector (`services/detector-service`)

**Graph construction** (`graph_builder.py`): builds a graph where nodes are accounts and edges are shared signals:

- Shared delivery address (exact or fuzzy-matched)
- Shared payment method (card BIN + last 4, or UPI handle pattern)
- Shared phone number pattern (sequential/disposable number ranges)
- Coordinated transaction timing (multiple accounts transacting within a tight window)
- Shared promo/referral code usage

Each edge carries a `signal_type` and a `confidence` - never an unlabeled connection (Rules.md, Principle 9).

**Clustering** (`clustering.py`): community detection (Louvain algorithm, via `python-louvain` or `networkx`) over the graph to find densely-connected account clusters. This is the buildable MVP choice - Graph Neural Networks (what FraudNet uses in production) are the stated future direction (PRD §11), not attempted here.

**Cluster scoring** (`cluster_scorer.py`): each cluster gets a `risk_score` from features including cluster size, signal density (how many distinct signal types link the accounts), timing coordination tightness, promo-abuse rate within the cluster, and chargeback rate within the cluster vs. baseline. Output: `{risk_score, evidence: [{signal_type, accounts_involved, confidence}]}`.

**Lightweight modules, same service:**

- `transaction_risk.py` - simple rules-based per-transaction score (amount anomaly, velocity, new device) - explicitly a Thirdwatch stand-in, feeds into cluster evidence as one more signal, not a standalone deliverable
- `chargeback_exposure.py` - sums historical/synthetic chargeback amounts tied to a cluster's accounts, for the ₹-at-risk figure shown on the dashboard

### 2.2 Verifier (`services/verifier-service`) - unchanged core design, new trigger condition

Same Sarvam AI stack as prior planning (`saaras:v3` STT, `bulbul:v3` TTS, hi-IN/en-IN/mr-IN for the live demo). **Trigger condition is now cluster-based, not transaction-based**: a cluster crosses into "borderline" (moderate confidence, or high-value accounts involved) rather than every flagged transaction.

**Call script, adjusted for ring-verification context:** not "did you make this transaction" (old design) but "we noticed your account shares [address/payment method] with another account - are you aware of this, and is that a family member or someone you know?" - captures confirm/deny/unclear same as before, but the underlying question is about _account linkage_, not _transaction authorization_.

### 2.3 Dashboard + Decision (`apps/web`)

The actual product surface - see Design.md for the full view-by-view spec. Summary: Rings Overview -> Ring Detail (network graph + evidence + exposure + verification status) -> merchant clicks Freeze / Block / Escalate / Dismiss (with reason).

**Dismiss-with-reason is a first-class data point**, not just a UI nicety - it feeds the false-positive-cost metric (PRD §9), so `merchant_decisions.action = "dismiss"` requires a `reason` field, enforced at the schema level, not just the UI.

### 2.4 Executor + Audit (`apps/api`)

Same discipline as prior designs: idempotent, only acts on explicit merchant decisions, one structured audit record per cluster covering the full evidence -> verification -> decision -> execution chain.

---

## 3. Why community detection, not a Graph Neural Network

GNNs are the documented current industry approach (FraudNet's 2026 marketing explicitly cites this) and are the _correct_ long-term answer. For a 10-day solo build, Louvain-style community detection over an explicit, hand-engineered signal graph is the honest choice: it's explainable (every edge has a labeled reason, which directly serves the dashboard's transparency requirement), fast to implement and evaluate, and doesn't require the training data volume a GNN would need to generalize well. State this trade-off explicitly in the README - it reads as informed judgment, not a limitation to hide.

---

## 4. Tech stack

| Layer                          | Choice                                                                   | Why                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Monorepo                       | Bun + Turborepo (zerostarter)                                            | Established, pre-wired DB + web + api                                                                                      |
| Backend / API                  | `apps/api` - Hono                                                        | Ingestion, orchestration, REST contract to Python services                                                                 |
| Dashboard                      | `apps/web` - Next.js                                                     | Where the actual product lives - see Design.md                                                                             |
| Graph visualization            | `react-force-graph-2d` (or D3 force-directed)                            | Renders the account network directly in the ring detail view - this is not optional polish, it's the core evidence display |
| Database                       | PostgreSQL + Drizzle ORM                                                 | Same pattern as prior planning                                                                                             |
| Detector                       | Python - `networkx` + `python-louvain`, scikit-learn for cluster scoring | Graph libraries are Python-native and mature; scoring model stays simple/explainable                                       |
| Verifier - STT/TTS             | Sarvam AI (`saaras:v3`, `bulbul:v3`)                                     | Unchanged from prior planning                                                                                              |
| `apps/api` <-> Python services | REST/JSON, not gRPC, through Phase 6                                     | Same reasoning as before - working pipeline over typed pipeline under this deadline                                        |

---

## 5. Data model

```sql
create table accounts (
  id uuid primary key,
  customer_ref text not null,
  delivery_address text,
  payment_method_fingerprint text,   -- e.g. card BIN+last4 or UPI handle pattern
  phone_number text,
  created_at timestamptz not null
);

create table transactions (
  id uuid primary key,
  razorpay_event_id text unique not null,
  account_id uuid references accounts(id),
  amount_paise bigint not null,
  promo_code text,
  created_at timestamptz not null
);

create table account_links (          -- the graph edges
  id uuid primary key,
  account_a uuid references accounts(id),
  account_b uuid references accounts(id),
  signal_type text not null,          -- shared_address | shared_payment | shared_phone_pattern | coordinated_timing | shared_promo
  confidence real not null
);

create table clusters (
  id uuid primary key,
  risk_score real not null,
  status text not null,               -- pending_review | pending_verification | resolved
  chargeback_exposure_paise bigint,
  created_at timestamptz not null default now()
);

create table cluster_members (
  cluster_id uuid references clusters(id),
  account_id uuid references accounts(id),
  primary key (cluster_id, account_id)
);

create table verifications (
  id uuid primary key,
  cluster_id uuid references clusters(id),
  account_id uuid references accounts(id),
  language_code text not null,
  transcript text,
  outcome text not null,              -- confirmed_linked | denied_linked | unclear | no_response
  confidence real
);

create table merchant_decisions (
  id uuid primary key,
  cluster_id uuid references clusters(id),
  action text not null,               -- freeze | block | escalate | dismiss
  reason text,                        -- required if action = dismiss
  decided_by text not null,
  decided_at timestamptz not null default now()
);

create table audit_log (
  id uuid primary key,
  cluster_id uuid references clusters(id),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
```

Implement via Drizzle (`apps/api/src/db/schema.ts`), same pattern as prior planning - this SQL is the logical reference, not hand-written migrations.

---

## 6. API contract

| Method          | Path                                      | Purpose                                                                                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET             | `/api/clusters?status=pending_review`     | List flagged clusters for the dashboard. Each row carries `signalTypes`, the distinct signals linking members, so the queue can say why a group was flagged without opening it                                                                                                                                  |
| GET             | `/api/clusters/:id`                       | Full cluster detail - graph data, evidence, exposure, verification status                                                                                                                                                                                                                                       |
| GET             | `/api/accounts/:id`                       | Account drill-down                                                                                                                                                                                                                                                                                              |
| POST            | `/api/clusters/:id/decision`              | Merchant submits freeze/block/escalate/dismiss(+reason)                                                                                                                                                                                                                                                         |
| POST            | `/api/clusters/detect`                    | **Implemented (Memory.md decision 23/24).** Calls the live detector-service below over HTTP against every account/transaction in Postgres, and persists what it finds - the actual live-agent trigger this table always specified but that wasn't wired until now. Manual/batch, not chained off every webhook. |
| GET             | `/api/metrics`                            | Precision/recall, false-positive cost, funnel numbers                                                                                                                                                                                                                                                           |
| POST            | `/webhooks/razorpay`                      | Ingest transaction events, idempotent                                                                                                                                                                                                                                                                           |
| (internal) POST | `services/detector-service /detect-rings` | Batch: builds graph, clusters, scores - returns clusters + evidence. Called by `POST /api/clusters/detect` above - this is no longer only exercised by evaluate.py/run_batch.py.                                                                                                                                |
| (internal) POST | `services/verifier-service /call`         | Triggers verification for a borderline account within a cluster                                                                                                                                                                                                                                                 |

---

## 7. Folder structure

```
fraud-ring-platform/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── db/schema.ts
│   │       ├── webhooks/razorpay.ts
│   │       ├── routes/{clusters,accounts,metrics}.ts
│   │       ├── clients/{detector-service,verifier-service}.ts
│   │       └── server.ts
│   └── web/
│       └── app/
│           ├── clusters/page.tsx          # Rings Overview
│           ├── clusters/[id]/page.tsx     # Ring Detail - graph + evidence + decision
│           └── accounts/[id]/page.tsx     # Account drill-down
├── services/
│   ├── detector-service/
│   │   ├── generate_synthetic_data.py     # rings + legitimate look-alikes
│   │   ├── graph_builder.py
│   │   ├── clustering.py
│   │   ├── cluster_scorer.py
│   │   ├── transaction_risk.py
│   │   ├── chargeback_exposure.py
│   │   ├── evaluate.py                    # held-out precision/recall/false-positive-cost
│   │   └── main.py                        # FastAPI, /detect-rings
│   └── verifier-service/
│       ├── sarvam_client.py
│       ├── conversation_flow.py           # ring-verification script, §2.2
│       ├── response_parser.py
│       ├── main.py                        # FastAPI, /call
│       └── call_harness/{simulated_call.py, twilio_call.py}
├── data/
│   └── synthetic_response_test_set.json
├── tests/
│   ├── test_clustering.py                 # correctness on synthetic rings + look-alikes
│   ├── test_cluster_scorer.py
│   ├── test_response_parser.py
│   ├── test_idempotency.py
│   └── test_audit_logging.py
├── docs/
├── turbo.json
├── docker-compose.yml
└── README.md
```

---

## 8. Local dev orchestration

Unchanged from prior planning: `docker-compose.yml` runs `services/*` (Python) alongside Postgres; root `dev` script runs `docker compose up -d` before `turbo dev`.

## 9. Telephony

Simulated-call-first, same as prior planning (Architecture §9 in the earlier version) - real Twilio/Exotel is a stretch item, not core.
