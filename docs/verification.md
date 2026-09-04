# Verification record

An end-to-end verification pass run on 4 September 2026 against a real Postgres, the live Python
detector, the Hono API and the Next console, all running together. This records what was exercised,
what passed, what was found and fixed, and what still cannot be verified.

It is a snapshot, not a guarantee. Re-run it after any change that touches detection, holds or the
webhook. Everything here is reproducible from [`testing.md`](testing.md) and [`running.md`](running.md).

---

## Gates

| Gate                   | Result                                   |
| ---------------------- | ---------------------------------------- |
| `bun run lint`         | clean                                    |
| `bun run format:check` | clean, 301 files                         |
| `bun run check-types`  | 12/12 packages                           |
| `bun run build`        | 6/6 tasks                                |
| `bun test tests`       | 33/33                                    |
| Python `unittest`      | 70/70, **0 skipped** (run with Postgres) |

The Python suite was run against a live Postgres so the ten DB-backed tests actually executed rather
than skipping. See the trap section in [`testing.md`](testing.md).

## Measurement reproducibility

Every measurement script was re-run from the committed inputs and its output diffed against what was
in `data/`.

On the first pass, six of seven reproduced byte for byte apart from their `generated_at` timestamp:
threshold selection, detector metrics, the adversarial suite, the hold replay, the batch run, and the
verifier. The figures this repo quotes came back identical, including the 0.45 threshold at a 0.2937
margin, 8-of-10 on the adversarial suite with the two documented failures at 0.6967 and 0.3876, and
the 24 / 0 / 68 / 8 hold confusion matrix.

`model_comparison.json` did not reproduce. That was a real bug, described below. After the fixes,
**all eight files including the model card reproduce**:

```
threshold_selection.json       REPRODUCIBLE
detector_metrics.json          REPRODUCIBLE
stress_test_report.json        REPRODUCIBLE
hold_verification_report.json  REPRODUCIBLE
batch_run_report.json          REPRODUCIBLE
verifier_metrics.json          REPRODUCIBLE
model_comparison.json          REPRODUCIBLE
ring_model_card.json           REPRODUCIBLE
```

## The live path

Seeded 396 accounts and 949 transactions with `seed_demo_data.py`, then triggered detection through
the API rather than by calling Python directly:

```
POST /api/clusters/detect
→ engine "detector-service", fallbackReason null,
  38 clusters detected, 16 flagged, 504 account links persisted
```

`fallbackReason: null` is the part that matters. It confirms the API reached the Python service over
HTTP and did not silently fall back to the TypeScript engine.

## Endpoints

All 39 operations were enumerated from the running app's own `GET /api/openapi.json` and exercised.

| Group                     | Result                                                     |
| ------------------------- | ---------------------------------------------------------- |
| Product endpoints         | 200                                                        |
| `/api/v1/*` (console)     | 401 without a session, as designed                         |
| `GET /api/waitlist`       | 404, correct: `features.waitlist` is `false`, so it is off |
| `GET /api/health/ws`      | WebSocket connects and streams a health frame              |
| Unknown cluster / hold id | 404                                                        |

## Webhook signature matrix

| Case                            | Result                                   |
| ------------------------------- | ---------------------------------------- |
| Valid signature                 | 200, ingested                            |
| Invalid signature               | 400 `WEBHOOK_SIGNATURE_MISMATCH`         |
| Missing signature header        | 400                                      |
| Body tampered after signing     | 400                                      |
| Same event redelivered          | 200, `ingested: false`, no duplicate row |
| Malformed JSON, valid signature | 400 `MALFORMED_PAYLOAD`                  |
| `RAZORPAY_WEBHOOK_SECRET` unset | 503, payload refused                     |

Two properties worth stating explicitly. The signature is verified over the raw body **before** the
JSON is parsed, so a malformed body is rejected on authenticity first. And an unset secret fails
closed with 503 rather than accepting unverified writes into the fraud graph.

## Hold and decision state machine

A coordinated ring was pushed through the webhook: four accounts on sequential SIMs sharing an
address, a card and a promo code.

```
member A (first ever payment)  → no hold
member B                       → HELD at risk 1.00
member C                       → HELD at risk 1.00
member D                       → HELD at risk 1.00
```

Member A getting no hold is correct, not a miss. On an account's first payment there are no
relationships in the graph yet, so there is nothing to detect. This is the same cold-start limit the
hold replay measures as 8 misses out of 8 first-payments.

| Action                             | Result                     |
| ---------------------------------- | -------------------------- |
| Reject a hold without a note       | 400, reason required       |
| Reject with a note                 | 200, status `rejected`     |
| Reject the same hold again         | 409, compare-and-set holds |
| Release after reject               | 409                        |
| Dismiss a cluster without a reason | 400, Principle 10          |
| Dismiss with a reason              | 200                        |
| Decide an already-decided cluster  | 409                        |

With no Razorpay API keys configured, rejecting a hold returns `refundSucceeded: false` and states
that the keys are missing, rather than reporting a refund that never happened.

## Console

Every page rendered with no console errors and no error boundaries: `/`, `/evidence`, `/clusters`,
`/clusters/[id]`, `/holds`, `/analysis`, `/metrics`, `/connect`, `/docs`, `/blog`. An unknown cluster
id correctly 404s.

This closes an item that had been open since the charts became animated.

## Voice

Sarvam text-to-speech and speech-to-text are live. A synthesized Hindi line was transcribed back
correctly through `POST /api/voice/listen`, which returns the transcript, the parsed outcome and the
spoken closing line together.

`POST /api/voice/speak` takes `language`, `role`, `turn` and `outcome`, not free text. It can only
speak pre-authored scripts, so the endpoint cannot be used to synthesize arbitrary attacker-supplied
speech. That is a defence-only property, not an accident of the schema.

## Production

Checked against the deployed console and API, not just locally.

| Surface                                        | Result                                      |
| ---------------------------------------------- | ------------------------------------------- |
| `kapat.dhirenderchoudhary.com`                 | 200 on all seven console pages, no errors   |
| `razorpay-buildathon-api.vercel.app`           | 200 on every read endpoint checked          |
| `kapat.dhirenderchoudhary.com/api/*`           | 200, the console proxies `/api` same origin |
| `api.kapat.dhirenderchoudhary.com`             | **TLS handshake failure**, see below        |
| `POST /webhooks/razorpay` with a bad signature | 400, and nothing was ingested               |

The console renders real detected cluster ids from the live API, so the full frontend to backend to
database path is working in production, not only in a local stack.

`api.kapat.dhirenderchoudhary.com` resolves to Cloudflare but cannot complete a TLS handshake. The
certificate's SANs are `*.dhirenderchoudhary.com` and `dhirenderchoudhary.com`, and a wildcard
matches exactly one label, so it does not cover the two labels in `api.kapat`. It needs a
certificate of its own, or a single-label host such as `kapat-api.dhirenderchoudhary.com`.

`/webhooks/razorpay` returns 404 on the console host because the console proxies `/api` only.
Razorpay's webhook must point at the API host.

---

## What this pass found

**A real reproducibility bug.** `services/detector-service/requirements-analysis.txt` floored
scikit-learn at `>=1.5`. Under a newer scikit-learn the model comparison produced different numbers,
and the README and `algorithm.md` still printed the old gradient-boosting row. Fixed by pinning the
analysis dependencies exactly and re-syncing the tables.

**A fragile threshold rule underneath it.** `choose_threshold_by_cost` took a plain `min` over the
cost curve. The curve is flat across a band rather than pointed, so the argmin returned whichever
tied threshold the sweep reached first, putting the operating point hard against the edge of the
plateau where the neighbouring threshold is already worse. Small floating-point differences between
environments then moved it. Now it takes the midpoint of the widest tied run, the same widest-margin
rule `select_threshold.py` already applied to the heuristic.

That change improved held-out results as well as stabilising them: the shipped hybrid went from 90.9%
precision at 4 costly errors to **95.2% at 2**.

**A second tie, in the ranking.** With the thresholds fixed, the hybrid and the plain random forest
tie exactly. `ranked.sort` keyed on cost alone, so which model got exported fell through to the order
`models()` happens to declare them in. The tie-break is now explicit: lowest cost, then highest
recall, then prefer the hybrid, because shipping the hybrid keeps the hand-built rule inside the
decision rather than beside it.

**Roughly 190 dangling documentation references.** Code comments across about 60 files cited
`Rules.md`, `Memory.md`, `PRD.md` and `Phases.md`, none of which are in the repository. The numbered
principles were the substantive ones, so they were reconstructed from the places the code cites them
into [`principles.md`](principles.md) and the citations now resolve. The purely historical pointers
were removed while keeping the sentence around them.

**Five dead identifiers**, removed.

---

## What is still unverified

- **Live Razorpay.** Order creation, capture, refund and real webhook delivery have never been
  exercised against `api.razorpay.com`. They are implemented to the documented contract and
  unit-tested against fixtures. Do not describe them as verified.
- **`docker compose up`.** Built and reviewed, never smoke-tested on a machine with a running Docker
  daemon.
- **Fluent-speaker review** of the Hindi and Marathi scripts.
- **The core assumption.** Everything above verifies the implementation. No amount of it can verify
  that real households share addresses but not sequential phone blocks, because the same conviction
  wrote the generator and the scorer. That needs real merchant traffic with real chargeback outcomes.
