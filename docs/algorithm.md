# How the agent detects fraud rings

**Track:** AI Risk Manager - abuse-ring sentinel
**One-line answer to "what algorithm is this?":** weighted-signal graph construction → Louvain
community detection → **corroboration-gated risk scoring** with a benign-explanation ceiling and a
decision threshold selected on the training split.

The third stage is the one that matters and the one that is ours. The first two are standard.

---

## The loss class

Promo/coupon abuse and coordinated chargeback rings: groups of accounts that look like separate
customers but are one operator, farming a promo or building up to a chargeback run. A single
transaction from any one of them looks completely normal. The fraud is only visible in the
_relationships between accounts_, which is why this is a graph problem and not a per-transaction
classifier.

## Stage 1 - Build the signal graph

`services/detector-service/graph_builder.py`

Nodes are accounts. Edges are **one specific shared signal** between two accounts. Five signal
types, each derived independently from raw fields (never from a stored answer key):

| Signal                 | Derived from                                                               | Confidence              |
| ---------------------- | -------------------------------------------------------------------------- | ----------------------- |
| `shared_address`       | exact delivery-address match                                               | 0.90                    |
| `shared_payment`       | exact payment-fingerprint match                                            | 0.85                    |
| `shared_phone_pattern` | phone numbers identical on every digit but the last (sequential SIM block) | 0.70                    |
| `coordinated_timing`   | transactions repeatedly firing inside a 10-minute window                   | 0.50–0.95, time-decayed |
| `shared_promo`         | same promo code inside a 24-hour window                                    | 0.40–0.80, time-decayed |

Every edge keeps its own `signal_type` and `confidence`. An edge carrying several signals keeps
all of them - collapsing them into one number is exactly what destroys the information the next
stage needs.

**One non-obvious detail:** `coordinated_timing` and `shared_promo` only fire after a pair
co-occurs **at least twice**. At real data volumes a single near-simultaneous transaction between
two unrelated accounts is common noise - hundreds of one-off pairs, a handful that repeat. The
2-hit floor is what makes repeated coordination a real pattern rather than a coincidence.

## Stage 2 - Find candidate groups

`services/detector-service/clustering.py`

Louvain community detection (networkx's built-in `louvain_communities`), weighted by edge
strength. Chosen over a Graph Neural Network deliberately: a GNN is the current published
gold standard but needs far more labelled training data than this build has. That is a stated
trade-off, not a hidden one.

Louvain finds groups that are _connected_. It says nothing about whether being connected is
suspicious - which is the entire problem, because **families are connected too.**

## Stage 3 - Score the group (this is the actual contribution)

`services/detector-service/cluster_scorer.py`

### The bug we found and fixed

The first version scored a flat weighted sum:

```
risk = 0.30*diversity + 0.25*size + 0.25*avg_confidence + 0.20*density
```

Measured on the held-out split: **100% recall, 41.7% precision.** Every legitimate household in
the test set was surfaced as a flagged cluster, two of them above the "high confidence" line.

The root cause is a double-counting error:

> **`density` and `avg_confidence` are not independent evidence - they are re-observations of the
> same fact.**

Three flatmates sharing one address produce a fully-connected triangle (density 1.0) of
high-confidence edges (0.90). The flat sum reads "dense! confident! decent size!" and adds three
separate-looking contributions. But there is **one** fact in evidence: these people live together.
That triple-counting put an innocent household at 0.61 on nothing but a shared address.

### The fix: corroboration, not accumulation

Score **how many independent kinds of evidence exist**, not how much of the same evidence exists.
Every signal is classified by one question - _does an ordinary honest household produce this in
the normal course of being a household?_

**Benign-explainable** (yes, routinely - weight 1.0 each)

- `shared_address` - families, flatmates, hostels, offices, PO boxes
- `shared_payment` - one family card or UPI handle paying for several people

**Fraud-specific** (no, or only weakly)

- `coordinated_timing` - **weak**, weight 2.0. Real households genuinely do order together.
- `shared_promo` - **strong**, weight 3.0. A household has no reason to funnel one code through separate accounts. This _is_ the loss class.
- `shared_phone_pattern` - **strong**, weight 3.5. Families do not buy consecutive SIM ranges. Bulk disposable-number vendors sell exactly this.

```
corroboration = Σ weight(signal types present) / 10.5
support       = 0.40*size + 0.35*density + 0.25*avg_confidence
raw_risk      = 0.70*corroboration + 0.30*support
```

### The ceiling rule - the part that actually fixes precision

> A cluster is **capped at 0.40** unless it shows either
> **(a)** at least one _strong_ fraud-specific signal, or
> **(b)** at least two distinct fraud-specific signal types.

In plain language: _a group whose only connections are a shared address and a shared payment
method can never be flagged, because a family is a complete explanation for that. Getting flagged
requires at least one signal a family does not produce._

The deliberate consequence: a household that shares an address **and** a card **and** repeatedly
orders at the same time - three overlaps, fully dense, the hardest legitimate case - is still
capped and still never flagged. That case is pinned by a test.

This matches published industry practice. Fixelsmith's fraud-ring write-up: _"A shared apartment
address by itself is weak. Shared apartment address plus shared device plus shared payment method
is still strong."_ Swiggy's engineering team reached the same conclusion on Indian marketplace
data and called it _domain-aware weighted community detection_.

## Stage 4 - The decision threshold

`services/detector-service/select_threshold.py` → `data/threshold_selection.json`

A detector that surfaces every community it finds has no decision boundary, and its "precision" is
close to meaningless. So there is a threshold - chosen **on the training split only**, by a rule
fixed in advance (among thresholds at maximum recall, take the highest precision; break ties by
widest margin to the nearest cluster score).

Selected: **0.45**, sitting in a stable band (0.30–0.55 all score identically on train) with a
**0.29 margin** to the nearest actual cluster score.

An earlier hand-picked 0.60 would have cost **23% recall**. That is precisely why the number is
selected by script and not by eye.

## Stage 5 - The agent stops

`api/hono/src/routers/clusters.ts` → `POST /api/clusters/detect`

The detector persists flagged clusters, writes its own reasoning verbatim into `audit_log`, and
**stops**. It never freezes, blocks, or moves money. Only a `merchant_decisions` row does that, and
only a human can create one. Dismissing requires a reason, enforced by a database CHECK constraint,
not UI copy.

---

## Measured results

### Held-out test split (`data/detector_metrics.json`)

|                                       | Before                               | After     |
| ------------------------------------- | ------------------------------------ | --------- |
| Recall on true rings                  | 100%                                 | **100%**  |
| Precision on flagged clusters         | 41.7%                                | **100%**  |
| Legitimate households wrongly flagged | 7 / 7 surfaced, 2 at high confidence | **0 / 7** |

Score separation: rings **0.59–0.79**, households **0.28–0.30**.

### Adversarial stress test (`data/stress_test_report.json`) - **8 / 10**

The held-out households are _easy_: they share exactly one thing. Real ones are messier and real
rings are not obliged to be sloppy. So there is a second, harder test - and it reports two genuine
failures:

**False positive - flatmates who pass around one coupon.** They share an address, a card, order
together, _and_ funnel one promo code. Scores 0.70, gets flagged. On the five signals available
this is **genuinely indistinguishable** from promo abuse. This is not a bug to paper over - it is
the case the voice verifier exists for: the system escalates to _asking the account holder_ rather
than acting.

**False negative - a maximally evasive ring.** Different addresses, different cards, ordinary
phone numbers, no promo reuse - only coordinated timing. Scores 0.39, held back. Correctly so:
"ordering at the same time" is what families do. This is the deliberate side of the
precision/recall trade.

---

## Would a trained model do better? We measured it, twice.

The scorer above is a judgment call encoded as arithmetic, so the obvious question is whether a
supervised model beats it. `train_model.py` answers it - and the answer depends entirely on which
dataset you ask on, which turned out to be the most important finding in the project.

### Attempt one: the question was unanswerable

On the original split every method scored a perfect 1.000 average precision, including an
**isolation forest fitted with no labels at all**. That is not five good models; it is one easy
dataset. `generate_synthetic_data.py` gives every ring all five signals and every household exactly
one, so a single feature separates the classes and memorising the generator is enough.

Quoting "100% average precision, beats four baselines" from that table would have been true and
worthless.

### The fix: a dataset where the classes overlap

`generate_hard_dataset.py` grades both populations.

| Rings, sloppy to careful              | Legitimate groups, easy to ambiguous             |
| ------------------------------------- | ------------------------------------------------ |
| `L0_sloppy` all five signals          | `H0_household` one shared address                |
| `L1_no_address` different addresses   | `H1_family_card` address + shared card           |
| `L2_burner_cards` different cards too | `H2_dinner_hour` + orders at the same time       |
| `L3_promo_crew` timing + promo only   | `H3_flatmates_coupon` + one coupon passed around |
| `L4_careful_sim` a SIM block alone    | `H4_office` an office delivery address           |
| `L4_careful_timing` timing alone      | `H5_reseller` one card, many addresses           |

`L3`/`L4` rings and `H2`/`H3` households sit on top of each other in signal space. No weighting of
those five signals can separate them, and any model reporting a perfect score on this data has a
bug. 2,613 accounts / 11,815 transactions train, 1,185 / 5,341 held out.

To keep it hard rather than impossible, rings also carry second-order structure the five signals do
not capture, all of it computable from fields the Razorpay payments API returns:

- **burst signup** - ring accounts are created for the purpose, days apart; households accumulate
  over months (`created_at`)
- **amount clustering** - ring orders sit just above the promo's minimum; household baskets vary
  (`amount`)
- **promo concentration** - what fraction of the group's transactions carry the same code
- **cadence uniformity** - ring members do similar amounts of work as each other

One in five rings is deliberately patient and one in five households deliberately signs up
together, so none of these is a label in disguise. This is an assumption about how fraud behaves,
stated as one.

### Attempt two: a real answer

| Method                                 | Precision | Recall   | Costly errors |
| -------------------------------------- | --------- | -------- | ------------- |
| **Hybrid (heuristic + random forest)** | **94.7%** | **100%** | **2**         |
| Random forest                          | 92.3%     | 100%     | 3             |
| Hist gradient boosting                 | 83.7%     | 100%     | 7             |
| Extra trees                            | 89.7%     | 97.2%    | 8             |
| Logistic regression                    | 87.5%     | 97.2%    | 9             |
| Corroboration heuristic alone          | 67.4%     | 86.1%    | 35            |
| Isolation forest (no labels)           | 0.840 AP  | -        | -             |

The unlabelled control drops from 1.000 to 0.840, which is the proof that the labels are now doing
real work.

**40 features**, in three families: the five signals and their confidences (what the heuristic
already uses), graph shape (density, clustering coefficient, degree spread, edge-signal entropy),
and behavioural structure (the four above, plus transaction spans, inter-arrival gaps and
Goh-Barabasi burstiness). See `features.py`.

**The threshold is chosen by expected cost**, on the training split, not by F1. F1 asserts that a
false positive and a false negative hurt equally; for a merchant holding a real customer's money
they do not. The cost model is `FP x 1, FN x 4` - an explicit, arguable policy dial recorded in the
report, not a measurement. There is still no calibrated rupee figure and there will not be one
until real chargeback outcomes exist.

**Probabilities are isotonic-calibrated**, because the cost model multiplies by probability and an
uncalibrated forest's 0.8 does not mean 80%.

### The hybrid is the interesting winner

The best model is the one handed the heuristic's own risk score as a final feature. It beats the
pure random forest (4 costly errors against 6) and demolishes the rule alone (against 45). Neither
component is sufficient: the rule encodes domain judgment the data cannot teach, and the model sees
behavioural structure the rule never looks at.

### Off-distribution, it does not regress

On the ten hand-authored adversarial cases in `stress_test.py` - written before any model existed,
never used for tuning - the trained model scores **9/10** against the heuristic's **8/10**. Its one
failure is `flatmates_pass_around_one_coupon` at 0.3744, just over its 0.30 operating threshold;
the heuristic fails that case too, and additionally holds back `ring_maximally_evasive`, which the
model catches. Read that margin as one case out of ten, not as a general ranking. A model trained on
the OLD easy split scores **6/10**, newly flagging two ordinary households including one that shares
an address, a card and a dinner hour. That gap is the clearest evidence that the harder dataset, not
the bigger ensemble, is what produced the improvement.

These case scores are reproducible. The suite used to seed each population from Python's `hash()`
of the case name, which is randomised per process, so every run moved the scores in the third and
fourth decimal while leaving the verdicts intact. `stress_test.case_rng` now seeds from sha256, and
`train_model.py` calls the same function so the models and the rule are compared on byte-identical
populations.

### It actually runs in the agent

`train_model.py --dataset hard --export` writes `data/ring_model.joblib` and a model card recording
the feature order, the operating threshold and the held-out numbers. `model_scorer.py` loads it
inside detector-service, and `POST /detect-rings` scores with it.

Three properties of that integration are deliberate:

- **The heuristic always runs too**, and its explanation always survives. The model supplies a
  better number; the rule supplies the sentence a merchant can act on.
- **Both verdicts are reported**, with `scorers_agree`. When a hand-built rule and a trained model
  disagree, that disagreement is the most interesting thing on the screen; averaging them into one
  number would destroy it.
- **It degrades rather than breaking.** No scikit-learn, no model file, or a feature list that no
  longer matches the card, and the service falls back to the heuristic with `GET /model` saying so
  out loud. A model card mismatch disables the model precisely because a forest will happily return
  a confident 0.91 for a scrambled input.

Full report: `data/model_comparison.json`. Model card: `data/ring_model_card.json`.

---

## What these numbers do **not** prove

The held-out split validates the **implementation** - the algorithm does what it claims on data it
never saw. It **cannot** validate the core **assumption**, because `generate_synthetic_data.py`
encodes the same belief the scorer does: that households share an address but not a sequential
phone block or a funnelled promo code. The same conviction authored both sides.

Real validation needs real merchant data with real chargeback outcomes. Until then the honest
claim is: _this is a well-tested implementation of a defensible domain model_, not _this is 99%
accurate on real fraud._

Two further honest limits:

- **No calibrated rupee cost of a false positive.** The generator models no chargebacks or
  verification friction, so a currency figure would be invented. The honest cost signal is the
  count of wrongly-flagged households and the score distribution.
- **Account tenure is deliberately not scored.** Burst signup is a genuinely useful real-world ring
  signal, but the generator assigns `created_at` at random to ring and household accounts alike, so
  a tenure feature would contribute pure noise while _looking_ like sophistication. Adding it would
  be dishonest sophistication, not a better detector.

## Reproduce it

```bash
python3 services/detector-service/select_threshold.py   # threshold, train split only
python3 services/detector-service/evaluate.py           # held-out precision/recall
python3 services/detector-service/stress_test.py        # adversarial cases
python3 services/detector-service/generate_hard_dataset.py       # the graded split
python3 services/detector-service/train_model.py --export        # comparison + the live model
python3 services/detector-service/make_figures.py       # charts, from the JSON above
python3 -m unittest discover -s tests -v                # test suite
```

## Sources

- Fixelsmith - _Detecting fraud rings: the social-graph problem in disguise_: https://analytics.fixelsmith.com/posts/fraud-rings/
- Swiggy Bytes - _Identifying Fraud Rings Using Domain Aware Weighted Community Detection_: https://bytes.swiggy.com/identifying-fraud-rings-using-domain-aware-weighted-community-detection-6a14c27c43e0
- Neo4j - _Graph-based financial fraud detection_: https://neo4j.com/developer/industry-use-cases/finserv/retail-banking/ieee-cis-fraud-graphs/
