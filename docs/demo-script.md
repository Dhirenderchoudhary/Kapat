# Demo script (5 minutes)

Structure: problem → live cluster detail view → voice verification
moment → metrics → what broke → close.

## 1. Problem (30s)

> "One transaction from a fraud ring looks completely normal by itself - that's exactly why
> per-transaction fraud scoring, like Razorpay's own Thirdwatch, misses coordinated rings. Four
> accounts sharing the same delivery address and payment fingerprint, each individually
> transacting normally, is invisible to a per-transaction model. It's only visible as a _graph_."

Open the Rings Overview (`/clusters`) - a table of flagged clusters, sorted by risk score.

## 2. Live cluster detail view (90s)

Click into one cluster (`/clusters/:id`). Walk through, in order:

- **Network graph** - accounts as nodes, edges labeled with the exact signal type and confidence
  on hover (never an unlabeled connection - `the governing principles` Principle 9). Click a node to show its
  per-account contribution.
- **Evidence panel** - the same graph translated into plain sentences a merchant reads in five
  seconds: _"4 accounts share the same delivery address," "3 accounts used the same promo code
  within 6 minutes of each other."_
- **Decide** - ₹ exposure figure, verification status, four buttons: Freeze / Block / Escalate /
  Dismiss. Say explicitly: _"None of this acted on its own - every one of these numbers only
  ever informs a human. Only this decision, made by a merchant, freezes or blocks anything."_
  Click Dismiss to show the required-reason flow (`the governing principles` Principle 10) - a short set of
  options, not a free-text box, because the reason is the data that makes the false-positive-cost
  metric honest.

## 3. Voice verification moment (60s)

Pick a borderline cluster (one that hasn't cleared the high-confidence threshold on graph
evidence alone). Show the verification transcript already on the cluster detail page, then narrate
the pipeline that produced it: `conversation_flow.py` built a script in the account holder's
language → `simulated_call.py` "placed" the call → `response_parser.py` parsed the answer with
rule-based keyword matching, in en-IN/hi-IN/mr-IN, Devanagari and romanized both.

Call out the inversion explicitly - it's the single easiest place for a silent bug in this system:
_"Confirming you know the other account leans this is a legitimate shared household. Denying any
knowledge of it is what actually strengthens the fraud-ring case - the opposite of what 'denied'
sounds like at first."_

## 4. Metrics (60s)

Open the metrics view (`GET /api/metrics`, Design.md §1.4 - "the screen the demo lingers on").
State the real, held-out numbers without rounding up:

- Detector: 100% recall / 41.7% precision on the held-out test split; 17/18 recall at full scale.
- Verifier: 100% (39/39) on the held-out synthetic response set - with the caveat said out loud:
  _"That's accuracy on a synthetic set we wrote ourselves. It is not the same claim as accuracy on
  a real call, which still needs a live Sarvam AI validation pass we haven't run yet."_
- Funnel: clusters flagged → verified → decided, queried live from Postgres, not canned.

## 5. What broke (45s)

Two real bugs/limitations, found by running evaluation scripts against held-out data, not by
inspection:

1. The verifier's parser initially scored 84.6%, not 100% - two real keyword-overlap bugs
   (fixed with a single shared span map across
   confirm/deny/hedge instead of three independent ones).
2. The detector's recall drops from 5/5 to 17/18 at full dataset scale - one ring gets absorbed
   into a larger predicted cluster once the graph is denser (IoU 0.400, just under the 0.5 match
   threshold). Not a bug: the actual cost of choosing Louvain community detection over a GNN for a
   10-day build, made explicit rather than hidden.

## 6. Close (15s)

> "Detection, verification, and decision-making are three different problems, solved with three
> different tools - a graph algorithm, a language model, and a plain rules table - and none of
> them acts without a human. That's the actual AI-judgment story here: the right tool in the right
> place, not one model doing everything because it can."
