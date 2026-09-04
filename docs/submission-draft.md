# Submission draft - Razorpay AI Buildathon, Track 02 (AI Risk Manager)

**This is a prepared draft only.** Submitting the actual application is a human step - it needs
your Razorpay account/contact details and a final decision to submit. Copy what is useful below
into the form.

## Project name

Ring Detector - an AI risk manager for coordinated multi-account abuse

## One-line summary

An agent that watches authorised Razorpay payments, finds the accounts working together behind
them, and **holds the funds instead of cancelling** - so the merchant, not the model, makes the
call.

## The loss class

One transaction from a fraud ring looks normal in isolation. Per-transaction scoring is mature at
Razorpay (Thirdwatch) and elsewhere; coordinated multi-account rings are a distinct, harder
problem, because the pattern exists only in the connections between accounts. The moment you start
scoring connections you hit the real difficulty: **families are connected too**. A detector that
cannot tell a fraud ring from a household is not usable, however high its recall.

## What was built

**Detection.** A signal graph over accounts (shared delivery address, shared payment fingerprint,
sequential phone block, coordinated timing, funnelled promo code), Louvain community detection to
find candidate groups, and a corroboration-gated risk score. The scoring rule is the contribution:
a group whose every link has an ordinary household explanation is **capped below the flagging
threshold**, no matter how dense it looks. Getting flagged requires at least one signal a family
does not produce.

**Live holds.** A verified Razorpay webhook (`payment.authorized`, raw-body HMAC) runs the detector
against everything that has arrived so far and, on a flagged group, places a hold using **manual
capture** - funds stay unsettled for up to three days and auto-refund if never captured. It never
cancels a payment. Capture and refund are reachable only after a recorded human decision, enforced
by a compare-and-set claim before the Razorpay call.

**Merchant surface.** Next.js dashboard: onboarding in English, Hindi, Marathi and Gujarati; the
network graph with every edge labelled by signal; the detector's own words stored at detection time
rather than reconstructed; a hold queue where each decision requires a reason (a database
constraint, which is what makes the false-positive rate real data instead of a guess). If Razorpay
is not connected, the whole product runs on committed synthetic data so a merchant can evaluate it
before handing over a key.

**Voice verification.** A rule-based trilingual parser resolves borderline groups by asking the
account holder directly. No LLM anywhere in the decision path - language models are used only to
understand what a person said, never to score risk or choose an action.

## Measured results

All reproducible from the repository; every number below is written to a JSON file by a script, and
the dashboard and README read those files rather than quoting remembered figures.

**Held-out split** (`data/detector_metrics.json`) - 12 detected groups, 5 true rings, 7 look-alike
households:

| Metric                                    | Value      |
| ----------------------------------------- | ---------- |
| Recall on true rings                      | 100% (5/5) |
| Precision on flagged groups               | 100%       |
| Households wrongly flagged                | 0 / 7      |
| Precision _before_ the corroboration gate | 41.7%      |

The threshold (0.45) was selected on the **training** split by a rule fixed in advance, then
applied unchanged. A hand-guessed 0.60 would have cost 23% of recall.

**Live replay** (`data/hold_verification_report.json`) - 100 payments scored one at a time, each
using only what had already arrived:

| Outcome                        | Count |
| ------------------------------ | ----- |
| Fraud held                     | 24    |
| **Legitimate held by mistake** | **0** |
| Legitimate left alone          | 68    |
| Fraud missed                   | 8     |

All eight misses were that account's **first-ever** payment, when it has no links in the graph
yet - a structural ceiling, not a tuning failure. Recall after an account has been seen once is
100%. The blended 75% figure is reported alongside, not instead of, that split.

**Adversarial suite** (`data/stress_test_report.json`) - ten hand-authored populations the
generator never produces: **8 / 10**, with both failures published rather than tuned away.

**Would a trained model do better?** (`data/model_comparison.json`) - we measured it instead of
assuming:

| Method                                        | Easy-split AP | Graded-split cost | Adversarial |
| --------------------------------------------- | ------------- | ----------------- | ----------- |
| **Hybrid: heuristic + random forest (ships)** | 1.000         | **4**             | **9 / 10**  |
| Random forest                                 | 1.000         | 6                 | -           |
| Gradient boosting                             | 1.000         | 7                 | -           |
| Logistic regression                           | 1.000         | 12                | -           |
| Corroboration heuristic (no training)         | 1.000         | 45                | 8 / 10      |
| Model trained on the EASY split only          | 1.000         | -                 | 6 / 10      |

The easy-split column is all ties - including for a hand-written rule that never saw a label -
which means that column is measuring the split, not the method. Two harder evaluations separate
them. On a graded dataset where the classes genuinely overlap, the hybrid makes 4 costly errors
where the rule alone makes 45. On ten hand-authored adversarial populations neither generator
produces, the hybrid scores 9/10 to the rule's 8/10, a margin of exactly one case. The model
trained on the easy split scores 6/10, newly flagging two ordinary households: evidence that the
harder dataset, not the bigger ensemble, is what produced the gain. The forest's top features turn
out to be the signals the heuristic weights by hand, so it re-derived the rule rather than finding
something the rule missed. The shipped scorer keeps the rule's plain-language explanation attached
to every model verdict, and reports both so disagreement stays visible. Full reasoning in
`docs/algorithm.md`.

**Verifier** - 100% (39/39) on a held-out synthetic response set across three languages, after
finding and fixing two real keyword-overlap bugs during evaluation.

## Cost of a false positive

Stated honestly: there is **no calibrated rupee figure**, because the synthetic data models no
chargebacks and no verification friction, and a currency number invented here would be fabricated
confidence. The honest cost signal is the count of wrongly-flagged households (0 of 7 held-out, 0
of 100 replayed payments) and the two published adversarial false positives - each one a real
household that would have seen a hold it did nothing to earn.

## Defence-only

- The agent can place a hold and release one. It cannot capture or refund without a recorded human
  decision.
- It never freezes or blocks an account, and never cancels a payment.
- Every flag stores the detector's own reasoning at detection time; there are no unlabelled edges.
- Nothing in the repository helps anyone commit fraud, probe defences, or evade detection. It finds
  coordinated abuse against a merchant and hands it to that merchant.

## Tech stack

Next.js 16 + Hono (TypeScript, Bun/Turborepo monorepo), Drizzle ORM + Postgres, Python/FastAPI
detector and verifier services, networkx (Louvain), scikit-learn and matplotlib for the offline
model comparison and figures, Razorpay Orders/Payments/Webhooks with manual capture as the hold
mechanism, Sarvam AI for voice (credential validation still pending).

## Disclosed gaps

- **No live Razorpay round trip has been executed from the build environment**, which has no
  outbound access to `api.razorpay.com`. Order creation, capture, refund and webhook delivery are
  implemented against the documented API with both signature schemes handled separately (checkout:
  HMAC over `order_id|payment_id` with the key secret; webhook: HMAC over the raw body with the
  webhook secret), and are covered by 24 passing unit tests - but they have not been observed
  against the live API. This is stated in the code and on the connect page, not papered over.
- **The synthetic data encodes the detector's own assumption** - that honest households share an
  address but not a sequential SIM block or a funnelled promo code. The held-out split validates
  the _implementation_; it cannot validate the _assumption_, because the same conviction authored
  both sides. Real validation needs real merchant traffic with real chargeback outcomes.
- Live Sarvam AI voice validation in Hindi and Marathi, checked by a fluent speaker, is not done.
- Account tenure is deliberately **not** scored: the generator assigns signup dates at random, so a
  tenure feature would contribute pure noise while looking like sophistication.

## Track

Track 02 - AI Risk Manager.

## Team

Solo builder.
