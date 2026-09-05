# HANDOFF - everything a new session needs to work on this repo

You are picking up a solo entry for the **Razorpay AI Buildathon, Track 02 (AI Risk Manager)**.
This file is the briefing. Read it before touching anything. It is written to be sufficient on its
own, and it points at the files that hold the detail.

The bar the buildathon set, quoted, because every decision in this repo traces back to it:

> Build a working detector, verifier or auto-responder for one class of loss, with measured
> precision and recall on a held-out test set. Honest metrics including false-positive cost.
> Strictly defense-only: anything offense-capable is disqualified.

---

## 0. Hard rules. Break these and you damage the project.

**Repo conventions** (also in `CLAUDE.md` / `AGENTS.md`, which win over this file if they differ):

- Use `@/` for imports in the Next app.
- Keep documentation in sync with every change. Docs drifting from code is treated as a bug here.
- **Never** put `Co-authored-by` in a commit message.
- **Never** use an em-dash (the long dash, U+2014) anywhere: code, comments, docs, or
  user-facing copy. The HTML entity for it counts too. Use a comma, colon, period, or a plain
  hyphen. `grep` for both forms before you hand work back.

**Working rules for this project:**

- **Do not commit or push unless explicitly asked.** The repo is normally left with a working tree
  full of changes on purpose. Check `git status` before assuming anything is committed.
- **Never invent a number.** Every metric in the README, the docs, the landing page and `/evidence`
  is read from a JSON file that a script wrote. If a measurement does not exist, say it does not
  exist. Do not fill a gap with a plausible figure, a rounded guess, or a rupee amount. This is the
  single most important property of the project and the thing that makes it credible.
- **Never claim 99% / unhackable / proven accurate.** The honest claim is stated in section 8 and
  must not be upgraded.
- **Defense only.** Nothing may become capable of committing fraud, probing defences, or evading
  detection. No page may imitate Razorpay's login or collect credentials.
- **Live Razorpay credentials must never be written to a file, a log, or a commit.** Test keys only.
  If a live key appears in conversation, tell the user to regenerate it immediately and do not use
  it.

---

## 1. What the product is

**Loss class:** coordinated multi-account abuse (fraud rings) against a merchant. One transaction
from a ring looks perfectly normal, so per-transaction scoring (Razorpay's own Thirdwatch, and
every velocity/amount rule) cannot see it. The pattern exists only in the connections between
accounts.

**The hard part, and the whole reason this project exists:** the moment you start scoring
connections, you hit the fact that **families are connected too**. A shared delivery address, a
shared card and orders at the same hour describe a fraud ring and a household equally well. A
detector that cannot tell them apart is unusable no matter how high its recall.

**What it does:** watches authorised Razorpay payments, finds the accounts working together behind
them, and **places a hold on the funds instead of cancelling the payment**. The merchant, not the
model, makes the final call.

---

## 2. Repo map

Bun + Turborepo monorepo. Workspaces: `api/*`, `packages/*`, `web/*`, plus non-workspace Python
services.

```
services/detector-service/    Python. The actual contribution.
  graph_builder.py            accounts + transactions -> signal graph (networkx)
  clustering.py               Louvain community detection
  cluster_scorer.py           THE ALGORITHM. Corroboration gating. Read this first.
  select_threshold.py         picks the flag threshold on the TRAIN split only
  evaluate.py                 held-out precision/recall
  stress_test.py              10 hand-authored adversarial cases
  verify_holds.py             replays payments one at a time, as the webhook would see them
  train_model.py              scikit-learn comparison vs the heuristic (offline analysis)
  make_figures.py             renders docs/images/*.svg|png from data/*.json
  run_batch.py                full-dataset run
  generate_synthetic_data.py  the dataset generator
  seed_demo_data.py           inserts raw accounts/transactions into Postgres, nothing else
  main.py                     FastAPI: POST /detect-rings
  requirements.txt            runtime deps (networkx, fastapi)
  requirements-analysis.txt   scikit-learn/numpy/matplotlib. NOT in the container.

services/verifier-service/    Python. Rule-based multilingual voice verification. No LLM.

api/hono/src/
  routers/clusters.ts         POST /api/clusters/detect calls the live detector over HTTP
  routers/webhooks.ts         Razorpay webhook. Raw-body HMAC, then hold on payment.authorized.
  routers/holds.ts            hold queue; capture/refund only after a recorded human decision
  routers/metrics.ts          reads data/detector_metrics.json, verifier_metrics.json,
                              model_comparison.json + live Postgres funnel counts
  routers/evidence.ts         reads all six data/*.json run reports
  lib/razorpay-signatures.ts  BOTH signature schemes, deliberately kept apart (see section 6)
  lib/razorpay-client.ts      read-only Razorpay reads, payment -> account/transaction mapping
  lib/razorpay-capture.ts     capture/refund, gated
  lib/hold-decision.ts        compare-and-set claim before any Razorpay call
  lib/crypto.ts               AES-256-GCM credential encryption, throws if no key (no fallback)

web/next/src/
  app/page.tsx                landing page. Chart-led, minimal prose.
  app/evidence/page.tsx       the evidence dossier: every measurement, failures included
  app/holds/, clusters/, analysis/, metrics/, connect/
  app/**/loading.tsx          one per route. Every console page is force-dynamic against a
                              separate API deployment, so a navigation is a 1-2s round trip and
                              without these the click painted nothing at all. They are also the
                              only thing <Link prefetch> can fetch ahead for a dynamic route.
  components/shell/page-skeleton.tsx     the pieces those loading files are built from
  components/common/route-progress.tsx   useLinkStatus feedback: a portalled top bar, plus
                                         LinkPending for a spinner on the clicked control
  components/fraud/cluster-verdict.ts    the one-sentence "why is this flagged", derived from the
                                         same evidence and detector record the page renders
  components/fraud/connect-workbench.tsx three ways in as one choice, not four stacked sections
  components/fraud/animated-charts.tsx   the app's charts. Live, animated, theme-aware.
  components/fraud/charts.tsx            older static charts (ShareBar/BarChart), still used
  components/fraud/model-labels.ts       one place where model/feature keys get human names
  components/marketing/sections.tsx      Section + CompareTable
  lib/i18n/messages.ts        en / hi / mr / gu, 33 keys each

packages/db/                  Drizzle schema + hand-written SQL migrations
data/                         every run report, committed. The source of truth for all numbers.
docs/algorithm.md             the full algorithm writeup, including the ML comparison
docs/submission-draft.md      what goes in the buildathon form
docs/images/                  static figures for docs and slides only. The app does NOT use these.
tests/                        Python unittest, node tests (*.mjs), bun tests (*.test.ts).
                              `bun run test` runs both JS runners; the Python suite needs a DB.
```

Note: several code comments reference `Memory.md` and `Rules.md`. **Those files no longer exist.**
Treat the references as historical. Do not recreate them without asking.

---

## 3. The algorithm, precisely

### Signals (`graph_builder.py`)

Accounts are nodes. Each shared signal is its own labelled edge with its own confidence:

| Signal                                        | Class                 | Corroboration weight |
| --------------------------------------------- | --------------------- | -------------------- |
| `shared_address`                              | benign-explainable    | 1.0                  |
| `shared_payment`                              | benign-explainable    | 1.0                  |
| `coordinated_timing`                          | weak fraud-specific   | 2.0                  |
| `shared_promo`                                | strong fraud-specific | 3.0                  |
| `shared_phone_pattern` (sequential SIM block) | strong fraud-specific | 3.5                  |

Timing and promo edges only fire after a pair co-occurs **at least twice**. One near-simultaneous
order between strangers is ordinary noise at real volume; repetition is a pattern.

### Grouping

Louvain community detection, weighted by edge strength. Deterministic under a fixed seed. This
finds groups that are _connected_. It says nothing about whether being connected is suspicious.

### Scoring (`cluster_scorer.py`) - this is the contribution

```python
BENIGN_EXPLAINABLE   = {"shared_address", "shared_payment"}
WEAK_FRAUD_SPECIFIC  = {"coordinated_timing"}
STRONG_FRAUD_SPECIFIC = {"shared_phone_pattern", "shared_promo"}

WEIGHT_CORROBORATION = 0.70
WEIGHT_SUPPORT       = 0.30
MAX_CORROBORATION_WEIGHT = 10.5
BENIGN_ONLY_CEILING  = 0.40
FLAG_THRESHOLD       = 0.45
```

The ceiling rule:

```python
qualifies_for_full_score = has_strong_signal or n_fraud_specific_types >= 2
risk = raw_risk if qualifies_for_full_score else min(raw_risk, BENIGN_ONLY_CEILING)
```

In words: **a group whose every connection has an ordinary household explanation is capped below
the flagging threshold, no matter how dense it looks.** Getting flagged requires at least one
signal a family does not produce.

**Why this exists.** The first version scored density + average confidence + group size and gave a
legitimate three-flatmate household 0.61, over the line. Three flatmates sharing one address
produce a fully connected triangle of high-confidence edges, and a naive scorer reads that as three
separate pieces of evidence. There is only **one fact** in evidence: these people live together.
Density and confidence are re-observations of that same fact, not independent corroboration of it.
Counting them separately triple-counts one observation. Fixing that took precision from **41.7% to
100%** with no loss of recall, and it is the single most important change in the project's history.

### Threshold (`select_threshold.py`)

Rule fixed **in advance**: among thresholds achieving maximum recall on the TRAIN split, take the
highest precision; break ties by widest margin to the nearest actual cluster score. It selected
**0.45**. On the train split the lowest flagged score is 0.5929 and the highest unflagged is
0.2992, a margin of **0.2937**, so the exact cut inside that band changes nothing. An earlier
hand-guess of 0.60 would have cost **23% of recall**. The test split was read once, afterwards.

---

## 4. The live path: how a payment becomes a hold

1. Razorpay sends `payment.authorized` to `/api/webhooks/razorpay`.
2. `webhooks.ts` reads `c.req.text()` **first**, verifies HMAC-SHA256 over the **raw body** with
   `RAZORPAY_WEBHOOK_SECRET`, and only then parses. Returns 503 if that secret is unset.
3. The payment becomes an account + transaction row and the detector runs over everything that has
   arrived so far.
4. If the payment's group is flagged, a hold is created.
5. **The hold mechanism is Razorpay manual capture.** An authorised-but-uncaptured payment keeps
   the funds unsettled for up to three days and auto-refunds if never captured. The agent never
   cancels a payment.
6. Capture or refund happens only after a **recorded human decision**, behind a compare-and-set
   claim in `hold-decision.ts` so a double-click cannot double-call Razorpay.

Detection failure never fails the webhook.

---

## 5. Every measured number, and the file it comes from

Do not quote any of these from memory. Read the file.

**`data/detector_metrics.json`** - held-out split, 12 detected groups, 5 true rings, 7 look-alike
households:

| Metric                                | Value     |
| ------------------------------------- | --------- |
| Recall on true rings                  | 1.0 (5/5) |
| Precision on flagged groups           | 1.0       |
| Look-alike households wrongly flagged | 0 / 7     |
| Precision _without_ the threshold     | 0.4167    |
| Flag threshold                        | 0.45      |

**`data/hold_verification_report.json`** - 100 payments replayed one at a time, contiguous time
window, each scored using only what had already arrived:

| Outcome                  | Count |
| ------------------------ | ----- |
| Fraud held (TP)          | 24    |
| Legitimate held (FP)     | 0     |
| Legitimate released (TN) | 68    |
| Fraud missed (FN)        | 8     |

Precision of holds 1.0, blended recall on fraud 0.75, specificity 1.0. **All 8 misses were that
account's first-ever payment**, when it has no relationships in the graph and there is nothing to
detect. Recall _after_ an account has been seen once is **1.0**. Always report that split. Quoting
0.75 alone understates a detector that is working correctly.

**`data/stress_test_report.json`** - 10 hand-authored adversarial cases: **8 correct**. The two
failures are in section 7. These scores are reproducible as of the fix to `case_rng`: the suite
used to seed each case from Python's `hash()` of the case name, which is randomised per process, so
every run produced slightly different scores in the third and fourth decimal. The verdicts were
always stable; the numbers were not. Re-run it and you now get the same values byte for byte.

**`data/threshold_selection.json`** - selected 0.45, margin 0.2937 (see section 3).

**`data/batch_run_report.json`** - full dataset: 396 accounts, 949 transactions, 40 ground-truth
groups (18 true rings, 22 look-alike households). 17 of 18 rings recovered at IoU 0.5; the one miss
was absorbed into a larger cluster at higher graph density, which is a documented Louvain-vs-GNN
trade-off, not a bug. 0 look-alikes flagged at high confidence.

**`data/verifier_metrics.json`** - 39/39 on a held-out synthetic response set across en-IN, hi-IN,
mr-IN, after finding and fixing two real keyword-overlap bugs during evaluation.

**`data/model_comparison.json`** - section 6.

---

## 6. The ML comparison, and what it actually shows

`train_model.py` extracts 40 features from the same live graph the detector builds (size, density,
average edge confidence, per-signal presence and confidence, counts of benign vs fraud-specific
signal types, transaction statistics). No feature reads a label. Six supervised models plus an
unsupervised isolation forest are trained on the TRAIN split only, selected by stratified 5-fold
cross-validation **inside** that split, scored by average precision rather than accuracy. The TEST
split is read once, at the end. Everything below is read from `data/model_comparison.json`.

**Result 1: the easy split cannot rank anything.**

| Method on the easy split (held-out AP)    | Value     |
| ----------------------------------------- | --------- |
| Logistic regression                       | 1.000     |
| Random forest                             | 1.000     |
| Extra trees                               | 1.000     |
| Gradient boosting                         | 1.000     |
| Hybrid (heuristic + random forest)        | 1.000     |
| **Corroboration heuristic (no training)** | **1.000** |
| Hist gradient boosting                    | 0.417     |
| Isolation forest (no labels at all)       | 0.517     |

The heuristic row is the finding. A hand-written rule that never saw a label, a training example or
a gradient step ties every supervised model at a perfect score. **A number an untrained rule also
reaches is measuring the split, not the method.** Train and test come from one generator that gives
every ring all five signals and every household exactly one, so a single feature separates the
classes. Never quote "100% average precision, beats four baselines" from this table.

(An earlier version of this section reported the isolation forest at 1.000 and made the same
argument through it. That was true when features.py produced 21 features; with 40 it scores 0.517,
so the argument now runs through the heuristic instead. The point is unchanged and the table is
what the current code produces.)

**Result 2: the graded split ranks them, and the hybrid wins.**

| Method on the hard split               | Precision | Recall   | Costly errors |
| -------------------------------------- | --------- | -------- | ------------- |
| **Hybrid (heuristic + random forest)** | **90.9%** | **100%** | **4**         |
| Random forest                          | 87.0%     | 100%     | 6             |
| Gradient boosting                      | 85.1%     | 100%     | 7             |
| Hist gradient boosting                 | 85.1%     | 100%     | 7             |
| Logistic regression                    | 76.9%     | 100%     | 12            |
| Extra trees                            | 76.9%     | 100%     | 12            |
| Corroboration heuristic alone          | 66.0%     | 82.5%    | 45            |

Costly errors is `false_positives x 1 + false_negatives x 4`, a policy dial stated in the report,
not a measurement.

**Result 3: off-distribution, the hybrid does not regress.** On the ten hand-authored adversarial
cases the hard-split model scores **9/10** against the heuristic's **8/10**, its only failure being
`flatmates_pass_around_one_coupon` (0.3744, just over its 0.30 threshold). It catches
`ring_maximally_evasive`, which the rule deliberately holds back. Read that as one case, not as a
general ranking: the margin is a single population out of ten. A model trained on the OLD easy
split scores **6/10**, newly flagging two ordinary households including one sharing an address, a
card and a dinner hour. That gap is the clearest evidence that the harder dataset, not the bigger
ensemble, produced the improvement.

**Result 4: the forest rediscovered the heuristic.** Top importances are dominated by the terms the
heuristic weights by hand: the phone-pattern signal and its confidence, the counts of benign versus
fraud-specific signal types, average confidence, and whether a strong signal is present. It
re-derived what was encoded; it did not find a missed signal. Read the current ordering from
`feature_importance` in the report rather than quoting it from here.

**What ships, and where to look:** the **hybrid model decides `flagged`**. `main.py`'s
`/detect-rings` calls `model_scorer.score()` and, when a usable model is on disk, its verdict
replaces the heuristic's while `heuristic_risk_score`, `heuristic_flagged`, `scorer` and
`scorers_agree` are all preserved beside it. The heuristic always runs, and its plain-language
explanation always survives, because "the ensemble said 0.91" is not a reason a merchant can act
on. With no scikit-learn, no model file, or a feature list that no longer matches the card, the
service degrades to the heuristic and `GET /model` says so.

An earlier version of this file said the heuristic ships and the models lose 6-7/10. That has not
been true since `model_scorer.py` was added, and the current measurements do not support it either.
If you find that claim anywhere else in the repo, it is stale: check `GET /model` for what is
actually running.

**This all changes with real data.** On real merchant traffic with real chargeback outcomes there
is far more for a model to learn than either generator can teach. Re-run `train_model.py` then; the
comparison is written to be repeated, not won once.

---

## 7. Where it breaks. Publish these, never tune them away.

**False positive, scored 0.6967 - `flatmates_pass_around_one_coupon`.** They share an address,
share a card, order together, and forward the same promo code to each other. On the five available
signals this is genuinely indistinguishable from promo abuse. Better weighting does not fix it; the
information is not there. This is the case voice verification exists for: ask the account holder,
in their language, rather than act on a guess.

**False negative, scored 0.3876 - `ring_maximally_evasive`.** Different addresses, different cards,
ordinary phone numbers, no promo reuse. Only coordinated timing links them. Held back deliberately:
ordering at the same time is what families do, and flagging on that alone would put real customers
in the review queue every day. This is the intended side of the trade.

**Cost of a false positive:** there is **no calibrated rupee figure**, because the generator models
no chargebacks and no verification friction. Inventing a currency number here would be exactly the
fabricated confidence this project refuses. The honest cost signal is the count of wrongly-flagged
households and the risk-score distribution.

**Account tenure is deliberately not scored.** Burst signup is a genuinely useful real-world ring
signal, but the generator assigns `created_at` at random to ring and household accounts alike, so a
tenure feature would contribute pure noise while looking like sophistication.

---

## 8. The honest claim, stated once

The held-out split validates the **implementation**: the algorithm does what it claims on data it
never saw. It **cannot** validate the core **assumption**, because `generate_synthetic_data.py`
encodes the same belief the scorer does - that households share an address but not a sequential
phone block or a funnelled promo code. The same conviction authored both sides.

> This is a well-tested implementation of a defensible domain model. It is not proven accurate on
> real fraud.

Real validation needs real merchant traffic with real chargeback outcomes. Do not upgrade this
sentence.

---

## 9. Running it

```bash
bun install
bun run db:migrate                 # needs POSTGRES_URL
bun run dev:local                  # THE ONE TO USE. See the portless note below.
bun run test                       # bun test tests
node tests/test_razorpay.mjs       # 24 Razorpay signature/crypto/mapping tests
python3 -m unittest discover -s tests -v
```

Regenerating every number this repo quotes:

```bash
python3 services/detector-service/select_threshold.py     # -> data/threshold_selection.json
python3 services/detector-service/evaluate.py             # -> data/detector_metrics.json
python3 services/detector-service/stress_test.py          # -> data/stress_test_report.json
python3 services/detector-service/verify_holds.py --n 100 # -> data/hold_verification_report.json
python3 services/detector-service/run_batch.py            # -> data/batch_run_report.json
python3 services/verifier-service/evaluate_verifier.py    # -> data/verifier_metrics.json
python3 services/detector-service/train_model.py          # -> data/model_comparison.json
python3 services/detector-service/make_figures.py         # -> docs/images/
```

`train_model.py` and `make_figures.py` need `services/detector-service/requirements-analysis.txt`.
Neither is installed in the detector container and neither runs on the live `/detect-rings` path.

Seeding the dashboard with data the **live agent** actually detected:

```bash
POSTGRES_URL=... python3 services/detector-service/seed_demo_data.py   # raw rows only
curl -X POST http://localhost:4000/api/clusters/detect -H 'content-type: application/json' -d '{}'
```

`seed_demo_data.py` deliberately does **not** compute clusters. An earlier version called the
Python pipeline directly, which worked but bypassed the running agent entirely. The detect endpoint
is the one place raw rows become clusters, and it goes through the real service over HTTP.

---

### Running the whole stack locally against a real database

The root `.env` `POSTGRES_URL` is the **shared Neon database canary and production both read**. Never
migrate or seed against it. Use the compose Postgres instead:

```bash
docker compose up -d postgres                      # port 5433, throwaway volume
for f in packages/db/drizzle/*.sql; do             # migrations are hand-written SQL
  docker exec -i razorpay_buildathon-postgres-1     psql -U razorpay -d razorpay -v ON_ERROR_STOP=1 -q < "$f"
done

# API. NODE_ENV and TRUSTED_ORIGINS both matter - see the traps below.
cd api/hono && NODE_ENV=development   POSTGRES_URL="postgres://razorpay:razorpay@localhost:5433/razorpay"   HONO_TRUSTED_ORIGINS="http://localhost:3210" PORT=4000 bun --hot src/index.ts

# Web, in another shell.
cd web/next && NODE_ENV=development   INTERNAL_API_URL=http://localhost:4000 NEXT_PUBLIC_API_URL=http://localhost:4000   bunx next dev -p 3210

# Seed: 396 accounts, 949 transactions, then score them.
curl -X POST http://localhost:4000/api/ingest/demo
curl -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:4000/api/clusters/detect
```

Detection reports `engine: typescript-fallback` unless the detector-service container is also up.
That is the documented fallback, not a failure.

---

## 10. Environment traps that have already cost hours

- **`bun run dev` uses portless**, which assigns random ports and `.localhost` hostnames, while
  `.env` hardcodes `localhost:4000`. That mismatch presents as "Network request failed" on every
  page. **Use `bun run dev:local`** (which runs the `dev:app` turbo task) unless you specifically
  want portless, in which case resolve URLs with `bunx portless get`.
- **Server-to-client function props throw.** Next cannot serialise a function across that boundary.
  Passing `valueLabel={(v) => ...}` from a server page into a client chart takes the whole page
  down with an error boundary. This broke `/analysis` and `/evidence` once. Every chart prop is a
  pre-formatted **string** for this reason. `/holds` kept working because it is fully client, and
  that asymmetry is the diagnostic clue if it happens again.
- **`node --experimental-strip-types` rejects TS transforms**, not just syntax. Constructor
  parameter properties fail. `RazorpayError` uses an explicit field because of this.
- **drizzle-kit could not run** in the environment the migrations were written in, so migrations
  under `packages/db/drizzle/` are **hand-written SQL**. Follow that pattern.
- **`turbo.json` is JSONC.** Patch it textually; `json.load` will choke on the comments.
- **matplotlib bakes text into paths.** A single SVG cannot recolour its labels for dark mode,
  which is why `make_figures.py` renders a light and a dark variant, and why the app draws its own
  charts instead of shipping images.
- **The build environment has had no outbound access to `api.razorpay.com` or to npm/PyPI.** Check
  before assuming an install or a live call will work.
- **`NODE_ENV=production` in `.env` forces SSL on every database connection.** `packages/db/src/index.ts`
  turns SSL on when the URL looks managed _or_ when NODE_ENV is production, and the root `.env` sets
  production. Point it at a local Postgres container without overriding NODE_ENV and the only symptom
  is `Client network socket disconnected before secure TLS connection was established`, which reads
  like a network fault rather than a config one. Prefix local runs with `NODE_ENV=development`.
- **The browser talks to the API cross-origin, not through a same-origin path.** `config.api.url`
  hands the client `NEXT_PUBLIC_API_URL` directly, so a local API must allow the web origin:
  `HONO_TRUSTED_ORIGINS=http://localhost:3210`. Without it every client-side call fails and the
  console shows the "API is not reachable" banner even though SSR is working, because SSR uses
  `INTERNAL_API_URL` and never leaves the server.

---

## 11. Current state

**Committed.** The body of work this section used to list as uncommitted - `train_model.py`,
`make_figures.py`, `requirements-analysis.txt`, `data/model_comparison.json`, `docs/images/`,
`animated-charts.tsx`, `model-labels.ts`, the rewritten `app/page.tsx`, the extended
`app/evidence/page.tsx`, `metrics.ts`, `evidence.ts`, `README.md`, `docs/algorithm.md`,
`docs/submission-draft.md` - is all on `canary`. Run `git status` rather than trusting this
paragraph: the tree is often left dirty on purpose, and the working rule still stands, **do not
commit or push unless explicitly asked.**

**Recently removed on purpose:** `web/next/public/figures/` and
`web/next/src/components/marketing/figure.tsx` (static SVGs became dead once the app drew its own
charts), and the unused `Stage` component in `sections.tsx`.

**Charts in the app are live and animated** (`animated-charts.tsx`): the pipeline dot travels, the
100-payment replay grid fills one square at a time in arrival order, bars grow, the threshold curve
draws itself. Two invariants there: every animation runs _from_ a transformed state _to_ the
element's ordinary CSS, so a reduced-motion or no-JS viewer still sees a complete chart; and motion
is only used where it explains something.

**Known open work:**

- No live Razorpay round trip has ever been executed: order creation, capture, refund, and webhook
  delivery are implemented against the documented API and unit-tested, but never observed against
  the live service. Disclosed in the code, on the connect page, and in the README. Do not describe
  them as verified.
- Live Sarvam AI voice validation in Hindi and Marathi, checked by a fluent speaker, is not done.
- `docker compose up` has been built and reviewed but not smoke-tested on a machine with a Docker
  daemon.
- The app has not been visually verified since the charts became animated. Run `bun run dev:local`
  and look at `/` and `/evidence`.

**Further reading, in the order that helps most:** `docs/algorithm.md` (the full argument),
`README.md` (metrics and how to reproduce), `Architecture.md` (components and API contract),
`docs/submission-draft.md` (what goes in the form), `ABOUT.md` and `Design.md` (product framing and
dashboard design).
