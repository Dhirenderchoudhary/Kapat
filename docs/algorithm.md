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
python3 -m unittest discover -s tests -v                # test suite
```

## Sources

- Fixelsmith - _Detecting fraud rings: the social-graph problem in disguise_: https://analytics.fixelsmith.com/posts/fraud-rings/
- Swiggy Bytes - _Identifying Fraud Rings Using Domain Aware Weighted Community Detection_: https://bytes.swiggy.com/identifying-fraud-rings-using-domain-aware-weighted-community-detection-6a14c27c43e0
- Neo4j - _Graph-based financial fraud detection_: https://neo4j.com/developer/industry-use-cases/finserv/retail-banking/ieee-cis-fraud-graphs/
