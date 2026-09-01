"""Scores a detected cluster and assembles its evidence (Architecture.md 2.1).

Phase 3 (Phases.md), built test-first per Rules.md's tdd guidance. Substantially redesigned in
Phase 10 (Memory.md decision 25) to fix a real precision failure - see below.

============================================================================================
THE ALGORITHM, IN ONE SENTENCE
============================================================================================
A group of accounts is risky in proportion to how many *independent kinds* of signal tie them
together - and a group whose every tie has a complete innocent explanation is capped below the
flagging threshold no matter how tightly connected it looks.

============================================================================================
WHY THE ORIGINAL SCORING MODEL WAS WRONG (the bug this redesign fixes)
============================================================================================
The original model was a flat weighted sum:

    risk = 0.30*diversity + 0.25*size + 0.25*avg_confidence + 0.20*density

Measured on the held-out split that produced 100% recall but only 41.7% precision: every
legitimate look-alike household in the test set was emitted as a predicted cluster, two of them
above the 0.6 "high confidence" line.

The root cause is a double-counting error, worth stating precisely because it is the single most
important design decision in this detector:

    density and avg_confidence are not independent evidence - they are re-observations of the
    same underlying fact.

Three flatmates sharing one delivery address produce a fully-connected triangle (density = 1.0)
of high-confidence edges (shared_address carries 0.90). The flat sum reads that as "dense! and
confident! and a decent size!" and adds up three separate-looking contributions. But there is
only ONE fact in evidence: these people live together. Counting its density and its confidence as
extra evidence on top of its presence triple-counts a single observation, and it put an innocent
household at 0.61 - over the line - on nothing but a shared address.

The fix: score *corroboration* (how many independent kinds of evidence exist) rather than
*accumulation* (how much of the same evidence exists), and make an innocent explanation an actual
ceiling rather than one term among several.

This matches the published industry approach to exactly this problem. Fixelsmith's write-up on
fraud rings as a social-graph problem puts it directly: "A shared apartment address by itself is
weak. Shared apartment address plus shared device plus shared payment method is still strong" -
and names the dominant false-positive sources as apartment complexes, dormitories, family phone
plans, corporate offices and commercial mail services, all of which produce exactly one kind of
overlap. Swiggy's engineering team reached the same conclusion from Indian marketplace data and
called it "domain aware weighted community detection": not all shared attributes deserve the same
weight, and the weighting has to come from knowing what an honest customer looks like.

============================================================================================
THE TWO SIGNAL CLASSES (the domain knowledge, stated explicitly)
============================================================================================
Every signal type is classified by ONE question: does an ordinary, honest household produce this
signal in the normal course of being a household?

BENIGN-EXPLAINABLE - yes, routinely. Little standalone risk:
  - shared_address       Families, roommates, dormitories, apartment blocks, corporate offices,
                         PO boxes and mail-forwarding services all share addresses. The single
                         most common false-positive source in the literature.
  - shared_payment       One household card or UPI handle paying for several people is ordinary -
                         a parent paying for children, one flatmate fronting a group order.

FRAUD-SPECIFIC - no, or only rarely and weakly. Real risk:
  - coordinated_timing   WEAK. Repeated transactions inside a ~10-minute window. A real household
                         genuinely does this sometimes (everyone orders dinner together), which is
                         why this alone is NOT enough to lift a cluster past the ceiling.
  - shared_promo         STRONG. The same promo code reused across linked accounts inside 24h.
                         Promo abuse is the actual loss class this detector exists to catch, and a
                         household has no reason to funnel one code through separate accounts.
  - shared_phone_pattern STRONG. Numbers identical on every digit but the last - a sequential
                         block. Families do not buy consecutive SIM ranges; bulk disposable-number
                         vendors sell exactly this. No ordinary-household explanation exists.

============================================================================================
THE CEILING RULE (the part that actually fixes precision)
============================================================================================
    A cluster is capped at BENIGN_ONLY_CEILING unless it shows either
      (a) at least one STRONG fraud-specific signal, or
      (b) at least two distinct fraud-specific signal types.

Plainly: "a group whose only connections are a shared address and a shared payment method can
never be flagged, because a family is a complete explanation for that. Getting flagged requires
at least one signal a family does not produce."

Condition (b) lets weak evidence combine into a flag; condition (a) lets one unmistakable signal
suffice. The deliberate consequence: a household sharing an address AND a payment method AND
sometimes ordering at the same time - three overlaps, fully dense, the hardest legitimate case -
is still capped and still never flagged, because none of its overlaps is something a family
doesn't do. That case is tested directly in tests/test_cluster_scorer.py.

============================================================================================
HONEST LIMITS (Rules.md Principle 5 - read before quoting any number from this file)
============================================================================================
1. These weights are judgment calls informed by domain reasoning and the cited industry write-ups.
   They are NOT fitted, trained, or calibrated against outcome data. risk_score is a ranking
   signal, not a probability. "scoring_method": "heuristic" on every returned dict says so.
2. The evaluation this scorer is measured on uses synthetic data whose generator encodes the same
   real-world assumption this scorer encodes (households share an address but not a sequential
   phone block or a funnelled promo code). The held-out split therefore validates the
   IMPLEMENTATION - the algorithm does what it claims on data it never saw - but cannot
   independently validate the ASSUMPTION, because the same belief authored both sides. Real
   validation needs real merchant data with real chargeback outcomes. evaluate.py restates this
   caveat next to the numbers it prints, on purpose.
3. Account tenure / burst-signup is a genuinely useful real-world ring signal (rings register in
   batches, families do not) and is deliberately NOT scored here: generate_synthetic_data.py
   assigns created_at at random to ring and household accounts alike, so a tenure feature would
   contribute pure noise on this dataset while looking like sophistication. Adding it would be
   dishonest sophistication, not a better detector. Listed in the README as real future work,
   gated on real data.

============================================================================================
WHAT IS NOT IN risk_score
============================================================================================
No chargeback-rate feature: generate_synthetic_data.py does not model chargebacks, so folding a
literal chargeback rate in would mean inventing data (Principle 5). Phase 4's transaction_risk.py
and chargeback_exposure.py instead attach "transaction_risk_contribution" and
"chargeback_exposure_paise" to the result when accounts/transactions are supplied - both stay
outside risk_score's own formula and stay traceable to specific transaction ids.
"""

from __future__ import annotations

import networkx as nx

import chargeback_exposure
import transaction_risk

KNOWN_SIGNAL_TYPES = (
    "shared_address",
    "shared_payment",
    "shared_phone_pattern",
    "coordinated_timing",
    "shared_promo",
)

# Signal classification - see "THE TWO SIGNAL CLASSES" above. The domain knowledge the whole
# detector rests on, so it lives in one named place rather than scattered as magic numbers.
BENIGN_EXPLAINABLE = frozenset({"shared_address", "shared_payment"})
WEAK_FRAUD_SPECIFIC = frozenset({"coordinated_timing"})
STRONG_FRAUD_SPECIFIC = frozenset({"shared_phone_pattern", "shared_promo"})
FRAUD_SPECIFIC = WEAK_FRAUD_SPECIFIC | STRONG_FRAUD_SPECIFIC

# Corroboration weight per signal type present. Graded by how hard the signal is to explain
# innocently, NOT by how confident the edge detector was about it (a separate axis - conflating
# the two is what broke the original model).
SIGNAL_CORROBORATION_WEIGHT = {
    "shared_address": 1.0,
    "shared_payment": 1.0,
    "coordinated_timing": 2.0,
    "shared_promo": 3.0,
    "shared_phone_pattern": 3.5,
}
MAX_CORROBORATION_WEIGHT = sum(SIGNAL_CORROBORATION_WEIGHT.values())  # 10.5

# Corroboration dominates; supporting features only modulate within the remaining band.
WEIGHT_CORROBORATION = 0.70
WEIGHT_SUPPORT = 0.30

# Supporting features - the "how much of the same evidence" terms. Useful for ranking two clusters
# that corroborate equally; never able to manufacture corroboration that isn't there.
SUPPORT_WEIGHT_SIZE = 0.40
SUPPORT_WEIGHT_DENSITY = 0.35
SUPPORT_WEIGHT_CONFIDENCE = 0.25

RING_SIZE_REFERENCE = 6  # Phase 1's true rings are size 3-6; size_score saturates here.

# The ceiling a benign-only cluster cannot exceed. Deliberately below every plausible flagging
# threshold: a cluster that reaches only this level should never reach a merchant's queue.
BENIGN_ONLY_CEILING = 0.40

# The flagging threshold. Selected on the TRAIN split only (select_threshold.py writes
# data/threshold_selection.json) and then applied unchanged to the held-out test split - never
# tuned by looking at test results, which would make the reported precision/recall meaningless.
# 0.45 is the train-selected value. It sits in a wide stable band (0.30-0.55 all score identically
# on train) with a 0.29 margin to the nearest cluster, so it is not balanced on a knife-edge. An
# earlier hand-guessed 0.60 would have cost 23% recall on train - which is exactly why this number
# is selected by script and not by eye.
FLAG_THRESHOLD = 0.45

# Retained for evaluate.py's "wrongly flagged at high confidence" reporting, which predates
# FLAG_THRESHOLD and means the same thing.
HIGH_CONFIDENCE_THRESHOLD = 0.6


def _internal_edges(graph: nx.Graph, member_ids: set[str]) -> list[tuple[str, str, dict]]:
    return [
        (a, b, data)
        for a, b, data in graph.edges(data=True)
        if a in member_ids and b in member_ids
    ]


def _transaction_risk_contribution(member_ids: set[str], accounts: list[dict], transactions: list[dict]) -> dict:
    """Phase 4: folds transaction_risk.py's per-transaction scores into this cluster's evidence.
    Scores every member account's transactions against that account's own history, then reports
    the average and the single highest-risk transaction - both traceable to real transaction ids,
    never a summary number invented independent of them."""
    accounts_by_id = {a["id"]: a for a in accounts}
    txns_by_account: dict[str, list[dict]] = {}
    for txn in transactions:
        if txn.get("account_id") in member_ids:
            txns_by_account.setdefault(txn["account_id"], []).append(txn)

    per_transaction_scores: dict[str, dict] = {}
    for account_id, account_txns in txns_by_account.items():
        account = accounts_by_id.get(account_id)
        if account is None:
            continue
        per_transaction_scores.update(transaction_risk.score_account_transactions(account, account_txns))

    if not per_transaction_scores:
        return {
            "avg_risk_score": 0.0,
            "highest_risk_transaction": None,
            "per_transaction_scores": {},
            "note": "no transactions found for this cluster's member accounts",
        }

    scores = [entry["risk_score"] for entry in per_transaction_scores.values()]
    highest = max(per_transaction_scores.values(), key=lambda entry: entry["risk_score"])
    return {
        "avg_risk_score": round(sum(scores) / len(scores), 4),
        "highest_risk_transaction": highest,
        "per_transaction_scores": per_transaction_scores,
    }


SIGNAL_LABEL = {
    "shared_address": "a shared delivery address",
    "shared_payment": "a shared payment method",
    "shared_phone_pattern": "phone numbers from one sequential block (a disposable-range pattern)",
    "coordinated_timing": "transactions repeatedly firing within minutes of each other",
    "shared_promo": "the same promo code funnelled through several accounts",
}


def _explain(*, signal_types_seen: set[str], ceiling_applied: bool, raw_risk: float, risk_score: float) -> list[str]:
    """Plain-language reasons a merchant can actually read, derived from the same values that
    produced the score - never written independently of it (Rules.md Principle 9: evidence is
    traceable, and that includes the explanation of the score itself)."""
    reasons: list[str] = []

    for signal in sorted(signal_types_seen & STRONG_FRAUD_SPECIFIC):
        reasons.append(f"Strong fraud-specific signal: {SIGNAL_LABEL[signal]} - no ordinary household produces this.")
    for signal in sorted(signal_types_seen & WEAK_FRAUD_SPECIFIC):
        reasons.append(f"Weaker fraud-specific signal: {SIGNAL_LABEL[signal]} - real households do sometimes do this.")
    for signal in sorted(signal_types_seen & BENIGN_EXPLAINABLE):
        reasons.append(f"Benign-explainable signal: {SIGNAL_LABEL[signal]} - common among families and flatmates.")

    if ceiling_applied:
        reasons.append(
            f"CAPPED at {BENIGN_ONLY_CEILING}: every connection in this group has an ordinary household "
            f"explanation, so it is held below the {FLAG_THRESHOLD} flagging threshold and never shown to the "
            f"merchant as a ring. Uncapped it would have scored {raw_risk}."
        )
    elif risk_score >= FLAG_THRESHOLD:
        reasons.append(
            f"FLAGGED: scored {risk_score}, at or above the {FLAG_THRESHOLD} threshold selected on the training split."
        )
    else:
        reasons.append(f"Not flagged: scored {risk_score}, below the {FLAG_THRESHOLD} threshold.")

    return reasons


def score_cluster(
    graph: nx.Graph,
    member_ids: set[str],
    *,
    accounts: list[dict] | None = None,
    transactions: list[dict] | None = None,
) -> dict:
    """Scores one detected cluster. accounts/transactions are optional - when both are supplied,
    Phase 4's transaction_risk.py / chargeback_exposure.py also run and their output is folded in
    as "transaction_risk_contribution" and "chargeback_exposure_paise". Callers passing only
    graph+member_ids keep working unchanged."""
    members = sorted(member_ids)
    size = len(members)
    edges = _internal_edges(graph, member_ids)

    evidence: list[dict] = []
    signal_types_seen: set[str] = set()
    confidences: list[float] = []
    confidence_by_signal: dict[str, list[float]] = {}
    for a, b, data in edges:
        for signal in data.get("signals", []):
            signal_type = signal["signal_type"]
            evidence.append(
                {
                    "signal_type": signal_type,
                    "accounts_involved": [a, b],
                    "confidence": signal["confidence"],
                    # The class travels WITH the evidence so the dashboard can explain why an edge
                    # did or didn't move the score without re-deriving the classification and
                    # risking it drifting out of sync.
                    "signal_class": (
                        "strong_fraud_specific"
                        if signal_type in STRONG_FRAUD_SPECIFIC
                        else "weak_fraud_specific"
                        if signal_type in WEAK_FRAUD_SPECIFIC
                        else "benign_explainable"
                    ),
                }
            )
            signal_types_seen.add(signal_type)
            confidences.append(signal["confidence"])
            confidence_by_signal.setdefault(signal_type, []).append(signal["confidence"])

    # --- Corroboration: how many INDEPENDENT kinds of evidence, weighted by how hard each is to
    # explain innocently. The dominant term, and the whole point of the redesign.
    corroboration_weight = sum(SIGNAL_CORROBORATION_WEIGHT.get(s, 0.0) for s in signal_types_seen)
    corroboration_score = corroboration_weight / MAX_CORROBORATION_WEIGHT if MAX_CORROBORATION_WEIGHT else 0.0

    # --- Supporting features: "how much of the same evidence". Can rank, cannot manufacture.
    size_score = min(size / RING_SIZE_REFERENCE, 1.0) if size else 0.0
    possible_pairs = size * (size - 1) / 2
    density_score = min(len(edges) / possible_pairs, 1.0) if possible_pairs else 0.0
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
    support_score = (
        SUPPORT_WEIGHT_SIZE * size_score
        + SUPPORT_WEIGHT_DENSITY * density_score
        + SUPPORT_WEIGHT_CONFIDENCE * avg_confidence
    )

    raw_risk = WEIGHT_CORROBORATION * corroboration_score + WEIGHT_SUPPORT * support_score
    raw_risk = round(min(max(raw_risk, 0.0), 1.0), 4)

    # --- The ceiling rule. See "THE CEILING RULE" in the module docstring.
    has_strong = bool(signal_types_seen & STRONG_FRAUD_SPECIFIC)
    n_fraud_specific_types = len(signal_types_seen & FRAUD_SPECIFIC)
    qualifies_for_full_score = has_strong or n_fraud_specific_types >= 2
    ceiling_applied = not qualifies_for_full_score

    risk_score = round(min(raw_risk, BENIGN_ONLY_CEILING) if ceiling_applied else raw_risk, 4)

    result = {
        "risk_score": risk_score,
        "flagged": risk_score >= FLAG_THRESHOLD,
        "evidence": evidence,
        "features": {
            "size": size,
            "size_score": round(size_score, 4),
            "density_score": round(density_score, 4),
            "avg_confidence": round(avg_confidence, 4),
            "corroboration_score": round(corroboration_score, 4),
            "corroboration_weight": round(corroboration_weight, 2),
            "support_score": round(support_score, 4),
            "signal_types_present": sorted(signal_types_seen),
            "benign_explainable_present": sorted(signal_types_seen & BENIGN_EXPLAINABLE),
            "fraud_specific_present": sorted(signal_types_seen & FRAUD_SPECIFIC),
            "strong_fraud_specific_present": sorted(signal_types_seen & STRONG_FRAUD_SPECIFIC),
            "avg_confidence_by_signal": {
                signal: round(sum(values) / len(values), 4) for signal, values in sorted(confidence_by_signal.items())
            },
        },
        "ceiling_applied": ceiling_applied,
        "raw_risk_score": raw_risk,
        "flag_threshold": FLAG_THRESHOLD,
        "explanation": _explain(
            signal_types_seen=signal_types_seen,
            ceiling_applied=ceiling_applied,
            raw_risk=raw_risk,
            risk_score=risk_score,
        ),
        "scoring_method": "heuristic",
        "scoring_note": (
            "risk_score is corroboration-gated: driven by how many INDEPENDENT signal types tie "
            "these accounts together, weighted by how hard each is to explain innocently, and capped "
            f"at {BENIGN_ONLY_CEILING} when every signal present is one an ordinary household also "
            "produces. Hand-built from domain reasoning, not a trained or calibrated model - treat it "
            "as a ranking signal, not a probability. See cluster_scorer.py's docstring."
        ),
    }

    if accounts is not None and transactions is not None:
        risk_contribution = _transaction_risk_contribution(member_ids, accounts, transactions)
        result["transaction_risk_contribution"] = risk_contribution
        result["chargeback_exposure"] = chargeback_exposure.compute_exposure(
            list(member_ids), transactions, risk_contribution["per_transaction_scores"]
        )
        result["chargeback_exposure_paise"] = result["chargeback_exposure"]["exposure_paise"]

    return result
