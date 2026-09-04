# Every number, and where it comes from

Principle 5 says never invent a number. The practical form of that rule is this file: every figure
quoted anywhere in this repo, the file that holds it, and the command that regenerates it.

If a number appears in the README, on the landing page, or on `/evidence` and is not in this table,
treat that as a bug and report it.

---

## The reproduce loop

Everything below regenerates from a clean checkout. Analysis scripts need the pinned environment in
`services/detector-service/requirements-analysis.txt`, which is pinned exactly rather than floored
for a reason given in that file.

```bash
python3 services/detector-service/select_threshold.py      # threshold_selection.json
python3 services/detector-service/evaluate.py              # detector_metrics.json
python3 services/detector-service/stress_test.py           # stress_test_report.json
python3 services/detector-service/verify_holds.py --n 100  # hold_verification_report.json
python3 services/detector-service/run_batch.py             # batch_run_report.json
python3 services/verifier-service/evaluate_verifier.py     # verifier_metrics.json
python3 services/detector-service/train_model.py --export  # model_comparison.json + ring_model.*
```

Six of the seven reproduce byte for byte. The seventh, `model_comparison.json`, carries a
`generated_at` stamp and is otherwise stable under the pinned dependencies; it was not stable before
those pins existed, which is why they are exact.

---

## Detector accuracy

**Source: `data/detector_metrics.json`** — held-out split, never used for tuning. 12 detected groups:
5 true rings, 7 look-alike households.

| Metric                                | Value     |
| ------------------------------------- | --------- |
| Recall on true rings                  | 1.0 (5/5) |
| Precision on flagged groups           | 1.0       |
| Look-alike households wrongly flagged | 0 / 7     |
| Precision _without_ the ceiling rule  | 0.4167    |
| Flag threshold                        | 0.45      |

The 0.4167 is the honest control. It is what the same detector scores on the same split with the
corroboration ceiling removed, and the gap between it and 1.0 is the entire contribution.

## Threshold selection

**Source: `data/threshold_selection.json`** — chosen on the TRAIN split only, by a rule fixed in
advance: among thresholds achieving maximum recall, take the highest precision, break ties by widest
margin to the nearest actual cluster score.

| Quantity                | Value  |
| ----------------------- | ------ |
| Selected threshold      | 0.45   |
| Highest unflagged score | 0.2992 |
| Lowest flagged score    | 0.5929 |
| Margin                  | 0.2937 |

The margin is the point. Any cut inside that band produces identical verdicts, so the exact value of
0.45 is not load-bearing. A hand-guess of 0.60 would have cost 23% of recall.

## Adversarial suite

**Source: `data/stress_test_report.json`** — 10 hand-authored cases, written before any model
existed, never used for tuning. **8 of 10 correct.**

The two failures are published rather than tuned away:

| Case                               | Expected    | Scored | Why it is left alone                                                                      |
| ---------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------------------- |
| `flatmates_pass_around_one_coupon` | not flagged | 0.6967 | Share an address, a card, an order hour and one promo code. Not separable on five signals |
| `ring_maximally_evasive`           | flagged     | 0.3876 | Linked by coordinated timing alone. Flagging on that would queue real families daily      |

The first is the case voice verification exists for. The second is the intended side of the trade.

## Hold decisions on a replay

**Source: `data/hold_verification_report.json`** — 100 payments replayed one at a time in arrival
order, each scored using only what had already arrived.

| Outcome                  | Count |
| ------------------------ | ----- |
| Fraud held (TP)          | 24    |
| Legitimate held (FP)     | 0     |
| Legitimate released (TN) | 68    |
| Fraud missed (FN)        | 8     |

Precision of holds 1.0, specificity 1.0, blended recall 0.75.

**Always report the recall split.** All 8 misses were that account's first-ever payment, when it has
no relationships in the graph and there is nothing to detect. Recall after an account has been seen
once is **1.0**. Quoting 0.75 alone understates a detector behaving correctly; quoting 1.0 alone
hides the cold-start limit. Both numbers, always.

## Full dataset run

**Source: `data/batch_run_report.json`** — 396 accounts, 949 transactions, 40 ground-truth groups
(18 true rings, 22 look-alike households).

17 of 18 rings recovered at IoU 0.5. The one miss was absorbed into a larger cluster at higher graph
density, a documented Louvain-versus-GNN trade-off rather than a scoring failure. 0 look-alikes
flagged at high confidence.

## Verifier

**Source: `data/verifier_metrics.json`** — 39/39 on a held-out synthetic response set across en-IN,
hi-IN and mr-IN, after finding and fixing two real keyword-overlap bugs during evaluation.

This is accuracy against a response set this project authored. It is **not** independent-transcript
accuracy, and no fluent speaker has reviewed the Hindi or Marathi scripts.

## Model comparison

**Source: `data/model_comparison.json`**, shipped model described by `data/ring_model_card.json`.

The easy split cannot rank anything: logistic regression, random forest, extra trees, gradient
boosting, the hybrid and the untrained heuristic all reach 1.000 average precision. A number an
untrained rule also reaches is measuring the split, not the method. Never quote that table as a win.

The graded split ranks them. Costly errors is `FP x 1 + FN x 4`, a policy dial stated in the report,
not a rupee measurement.

| Method                             | Precision | Recall | Costly errors |
| ---------------------------------- | --------- | ------ | ------------- |
| Hybrid (heuristic + random forest) | 95.2%     | 100%   | 2             |
| Random forest                      | 95.2%     | 100%   | 2             |
| Hist gradient boosting             | 92.9%     | 97.5%  | 7             |
| Extra trees                        | 80.0%     | 100%   | 10            |
| Gradient boosting                  | 80.0%     | 100%   | 10            |
| Logistic regression                | 78.4%     | 100%   | 11            |
| Corroboration heuristic alone      | 66.0%     | 82.5%  | 45            |
| Isolation forest (no labels)       | 0.645 AP  | n/a    | n/a           |

The hybrid and the plain forest tie exactly. The ranking breaks that tie explicitly rather than
letting declaration order decide which model gets exported: lowest cost, then highest recall, then
prefer the hybrid, because shipping the hybrid keeps the hand-built rule inside the decision instead
of beside it.

On the adversarial suite the hard-split model scores 9/10, the heuristic 8/10, and a model trained on
the old easy split 7/10. Read the first margin as one case out of ten, not a general ranking.

---

## Numbers that deliberately do not exist

Asking for these is reasonable. The answer is that they have not been measured, and a plausible
figure would be worth less than the gap.

- **Rupee cost of a false positive.** The generator models no chargebacks and no verification
  friction. The honest cost signal is the count of wrongly-flagged households and the risk-score
  distribution.
- **Real-world precision and recall.** Every number here is measured on synthetic data whose
  generator encodes the same household-versus-ring assumption the scorer uses. The same conviction
  authored both sides.
- **Live Razorpay round-trip results.** Order creation, capture, refund and webhook delivery are
  implemented against the documented API and unit-tested, but no environment this project has run in
  could reach `api.razorpay.com`.
- **Independent-transcript verifier accuracy.** 39/39 is against a self-authored response set.

## The honest claim

The held-out split validates the **implementation**: the algorithm does what it claims on data it
never saw. It cannot validate the core **assumption**, because the generator encodes the same belief
the scorer does.

> This is a well-tested implementation of a defensible domain model. It is not proven accurate on
> real fraud.

Real validation needs real merchant traffic with real chargeback outcomes. That sentence does not get
upgraded.
