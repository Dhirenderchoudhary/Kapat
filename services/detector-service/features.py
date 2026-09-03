"""Feature extraction for the ring classifier.

EVERY FEATURE HERE IS COMPUTABLE AT DETECTION TIME FROM DATA RAZORPAY ACTUALLY RETURNS.
=======================================================================================
That constraint is the whole design. A feature that needs a label, a future event, or a field the
payments API does not carry would inflate an offline score and then be unavailable the moment the
model went behind the live webhook. So: account creation timestamps, payment amounts, promo codes
from `notes`, and the graph the detector already builds. Nothing else.

Three families of feature, and the second and third are why this file exists at all:

  1. SIGNAL FEATURES - which of the five edge types fired, how confident, how many of each class.
     The hand-built scorer in cluster_scorer.py uses exactly these. A model given only these can
     at best re-derive the heuristic, which is what happened the first time we tried.

  2. GRAPH SHAPE - density, clustering coefficient, degree spread, edge-weight entropy. How the
     group is wired together, independent of what the wires mean.

  3. BEHAVIOURAL STRUCTURE - burst signup, amount tightness, promo concentration, cadence
     uniformity, timing dispersion. This is the family the heuristic does not look at, and the
     only place a trained model can find something the hand-built rule cannot.

Family 3 encodes an assumption, and it must be disclosed like any other: that accounts created for
a ring are created together, buy similarly-sized things, funnel promos, and behave uniformly,
while a household accumulates over months and shops unevenly. That is a belief about fraud, not a
measurement of it. It is stated in docs/algorithm.md next to the numbers it produces.
"""

from __future__ import annotations

import math
import statistics
from datetime import datetime

import cluster_scorer

SIGNALS = list(cluster_scorer.KNOWN_SIGNAL_TYPES)

FEATURE_NAMES = (
    # 1. signal features
    [
        "size",
        "n_edges",
        "density",
        "avg_confidence",
        "max_confidence",
        "min_confidence",
        "n_signal_types",
        "n_benign_types",
        "n_fraud_types",
        "has_strong_signal",
    ]
    + [f"has_{s}" for s in SIGNALS]
    + [f"conf_{s}" for s in SIGNALS]
    # 2. graph shape
    + [
        "avg_clustering_coefficient",
        "avg_degree",
        "degree_spread",
        "edge_signal_entropy",
        "edges_per_node",
    ]
    # 3. behavioural structure
    + [
        "txn_count",
        "txn_per_account",
        "cadence_uniformity",
        "amount_mean_paise",
        "amount_cv",
        "amount_tightness",
        "promo_fraction",
        "top_promo_concentration",
        "n_distinct_promos",
        "signup_span_days",
        "signup_burst_score",
        "signup_std_days",
        "txn_span_days",
        "median_gap_hours",
        "burstiness",
    ]
)


def _parse(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _safe_cv(values: list[float]) -> float:
    """Coefficient of variation, the scale-free way to ask 'are these all the same size?'."""
    if len(values) < 2:
        return 0.0
    mean = statistics.fmean(values)
    if mean == 0:
        return 0.0
    return statistics.pstdev(values) / mean


def _entropy(counts: list[int]) -> float:
    total = sum(counts)
    if total <= 0:
        return 0.0
    h = 0.0
    for c in counts:
        if c > 0:
            p = c / total
            h -= p * math.log(p, 2)
    return h


def extract(graph, members: set[str], accounts: list[dict], transactions: list[dict]) -> list[float]:
    """One cluster to one fixed-length feature vector. Order matches FEATURE_NAMES."""
    member_edges = [(a, b, d) for a, b, d in graph.edges(data=True) if a in members and b in members]

    conf_by_signal: dict[str, list[float]] = {s: [] for s in SIGNALS}
    all_conf: list[float] = []
    signal_counts: dict[str, int] = {s: 0 for s in SIGNALS}
    for _a, _b, data in member_edges:
        for sig in data.get("signals", []):
            st = sig["signal_type"]
            if st in conf_by_signal:
                conf_by_signal[st].append(sig["confidence"])
                signal_counts[st] += 1
            all_conf.append(sig["confidence"])

    present = {s for s, v in conf_by_signal.items() if v}
    size = len(members)
    possible = size * (size - 1) / 2
    density = min(len(member_edges) / possible, 1.0) if possible else 0.0

    # --- graph shape ---
    sub = graph.subgraph(members)
    try:
        import networkx as nx

        avg_clustering = nx.average_clustering(sub) if size > 2 else 0.0
    except Exception:
        avg_clustering = 0.0
    degrees = [d for _n, d in sub.degree()] or [0]

    # --- behaviour ---
    member_txns = [t for t in transactions if t.get("account_id") in members]
    amounts = [float(t["amount_paise"]) for t in member_txns] or [0.0]
    median_amount = statistics.median(amounts)

    per_account: dict[str, int] = {m: 0 for m in members}
    for t in member_txns:
        per_account[t["account_id"]] = per_account.get(t["account_id"], 0) + 1
    counts = list(per_account.values()) or [0]

    promos = [t.get("promo_code") for t in member_txns if t.get("promo_code")]
    promo_counter: dict[str, int] = {}
    for p in promos:
        promo_counter[p] = promo_counter.get(p, 0) + 1
    top_promo = max(promo_counter.values()) if promo_counter else 0

    created = [c for c in (_parse(a.get("created_at")) for a in accounts if a["id"] in members) if c]
    if len(created) >= 2:
        span_days = (max(created) - min(created)).total_seconds() / 86400
        offsets = [(c - min(created)).total_seconds() / 86400 for c in created]
        signup_std = statistics.pstdev(offsets)
    else:
        span_days, signup_std = 0.0, 0.0
    # 1.0 when every account appeared the same day, decaying to 0 over two months.
    signup_burst = max(0.0, 1.0 - span_days / 60.0)

    times = sorted(t for t in (_parse(x.get("created_at")) for x in member_txns) if t)
    if len(times) >= 2:
        txn_span = (times[-1] - times[0]).total_seconds() / 86400
        gaps = [(b - a).total_seconds() / 3600 for a, b in zip(times, times[1:])]
        median_gap = statistics.median(gaps)
        mean_gap = statistics.fmean(gaps)
        # Goh-Barabasi burstiness: +1 all at once, -1 perfectly regular, 0 Poisson.
        sd = statistics.pstdev(gaps)
        burstiness = (sd - mean_gap) / (sd + mean_gap) if (sd + mean_gap) > 0 else 0.0
    else:
        txn_span, median_gap, burstiness = 0.0, 0.0, 0.0

    return [
        # 1. signals
        float(size),
        float(len(member_edges)),
        density,
        statistics.fmean(all_conf) if all_conf else 0.0,
        max(all_conf) if all_conf else 0.0,
        min(all_conf) if all_conf else 0.0,
        float(len(present)),
        float(len(present & cluster_scorer.BENIGN_EXPLAINABLE)),
        float(len(present & cluster_scorer.FRAUD_SPECIFIC)),
        1.0 if present & cluster_scorer.STRONG_FRAUD_SPECIFIC else 0.0,
        *[1.0 if s in present else 0.0 for s in SIGNALS],
        *[statistics.fmean(conf_by_signal[s]) if conf_by_signal[s] else 0.0 for s in SIGNALS],
        # 2. graph shape
        float(avg_clustering),
        statistics.fmean(degrees),
        float(_safe_cv([float(d) for d in degrees])),
        _entropy([signal_counts[s] for s in SIGNALS]),
        float(len(member_edges) / size) if size else 0.0,
        # 3. behaviour
        float(len(member_txns)),
        float(len(member_txns) / size) if size else 0.0,
        # Low variation in how much each member transacts = the members are interchangeable.
        1.0 - min(_safe_cv([float(c) for c in counts]), 1.0),
        statistics.fmean(amounts),
        _safe_cv(amounts),
        # Fraction of orders within 20% of the group's own median order: a ring sizing every
        # basket to clear one promo floor scores high here, a household does not.
        sum(1 for a in amounts if median_amount and abs(a - median_amount) <= 0.2 * median_amount) / len(amounts),
        len(promos) / len(member_txns) if member_txns else 0.0,
        top_promo / len(member_txns) if member_txns else 0.0,
        float(len(promo_counter)),
        span_days,
        signup_burst,
        signup_std,
        txn_span,
        median_gap,
        burstiness,
    ]


assert len(extract.__doc__ or "") > 0
