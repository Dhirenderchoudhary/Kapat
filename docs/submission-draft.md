# Submission draft - Razorpay Buildathon Track 2

**This is a prepared draft only.** Submitting the actual application (forms.gle/d9r2gvxp8cmoZhon9)
is a human step - it needs your Razorpay account/contact details and a final decision to submit,
neither of which this session can do on your behalf. Copy what's useful from below into the form.

## Project name

AI Risk Manager - Fraud Ring Detection Platform

## One-line summary

Detects coordinated fraud rings - clusters of accounts sharing signals like delivery address or
payment fingerprint - that per-transaction fraud scoring (like Razorpay's own Thirdwatch) can't
see, then resolves borderline cases with an automated multilingual voice check before any merchant
decision, never acting autonomously.

## The problem

One transaction from a fraud ring looks normal in isolation. Per-transaction fraud scoring is
mature at Razorpay (Thirdwatch) and elsewhere, but coordinated multi-account rings are a distinct,
harder problem - confirmed by FraudNet's own 2026 marketing, which specifically names Graph Neural
Networks as necessary for "organized fraud ring" detection, separate from single-transaction
scoring.

## What was built

- A community-detection pipeline (`services/detector-service`) that graphs accounts by shared
  signal (address, payment fingerprint, phone pattern, promo code, coordinated timing), clusters
  with Louvain, and scores each cluster's risk and estimated chargeback exposure.
- A rule-based, trilingual (English/Hindi/Marathi) voice-verification pipeline
  (`services/verifier-service`) that resolves borderline clusters by asking the account holder a
  direct question and parsing the answer - no LLM in the decision path, by design.
- A full merchant dashboard (`web/next` + `api/hono`, Drizzle/Postgres) - network graph with every
  edge labeled, a plain-language evidence panel, and four decision actions (Freeze/Block/
  Escalate/Dismiss), each producing a full audit trail. No autonomous action anywhere: only an
  explicit merchant decision can freeze or block an account.

## Honest results (see README.md for the full numbers and how to reproduce them)

- Detector: 100% recall / 41.7% precision on a held-out synthetic test split; 17/18 recall at
  full dataset scale (one ring absorbed into a larger cluster at higher graph density - a real,
  documented Louvain-vs-GNN trade-off, not a bug).
- Verifier: 100% (39/39) on a held-out synthetic response set, after finding and fixing two real
  keyword-overlap bugs during evaluation - disclosed explicitly as _not_ equivalent to accuracy on
  real calls, which still needs a live validation pass.
- All data is synthetic, generated deterministically and committed to the repo; no real Razorpay
  merchant or customer data was used.

## Tech stack

Next.js 16 + Hono (TypeScript, Bun/Turborepo monorepo), Drizzle ORM + Postgres, Python/FastAPI
detector and verifier microservices, networkx (Louvain community detection), Sarvam AI (voice,
credential/live validation still pending), react-force-graph-2d for the network visualization.

## What's not done / disclosed gaps

- Live Sarvam AI voice validation (Phase 0 exit criteria) - needs a human-created Sarvam account.
- Razorpay test-mode account + ngrok webhook wiring for a real `/webhooks/razorpay` delivery.
- `docker compose up` as a real running stack - built and reviewed, not yet smoke-tested on a
  machine with a Docker daemon.
- The TypeScript API/dashboard layer was built and syntax-checked this development session but
  could not be compiled/run end-to-end due to a sandboxed environment with no package-registry
  network access; its correctness is instead demonstrated via SQL-level proofs against a real
  Postgres and ten passing automated idempotency/audit-logging tests (see `Memory.md` decision
  21 for the full account). Confirm this is resolved (a normal `bun install` + `bun run dev`) in
  your own environment before the live demo.

## Track

Track 2.

## Team

Solo builder.
