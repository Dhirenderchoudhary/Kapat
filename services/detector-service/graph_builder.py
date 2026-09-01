"""Builds the account signal graph (Architecture.md §2.1).

Phase 2 (Phases.md). Deliberately does NOT read account_links: in production those rows would
not exist yet - they are what this module's output eventually populates. Here they'd also be the
generator's ground truth for account grouping, so reading them would be scoring this detector
against an answer key handed to it (Rules.md's "don't train the evaluation on the same synthetic
batch" spirit, applied one level down: don't detect signals by reading the generator's answer key
either). Every signal below is instead re-derived independently from the same raw fields a real
detector would have: accounts.delivery_address / payment_method_fingerprint / phone_number, and
transactions.created_at / promo_code.

Nodes: accounts (accounts.id).
Edges: one per shared signal between two accounts, each carrying a signal_type and a confidence
in [0, 1] - never an unlabeled edge (Rules.md Principle 9). signal_type is one of:
shared_address | shared_payment | shared_phone_pattern | coordinated_timing | shared_promo
(matches the account_links.signal_type check constraint in packages/db/src/schema/fraud.ts).
An edge with more than one signal_type keeps every one of them in its "signals" list - a ring
sharing five signal types is stronger evidence than one sharing one, and that must stay visible,
not get collapsed into a single opaque number.

Confidence values below are fixed heuristic constants, not a calibrated model (Rules.md
Principle 5 - say so, don't dress up a guess as a probability):
  - shared_address / shared_payment: exact-match signals, high confidence (0.9 / 0.85) - a false
    positive here means two different people typed the identical string, which is rare.
  - shared_phone_pattern: accounts whose phone number matches on every digit but the last -
    the disposable sequential-block pattern (Architecture.md §2.1). 0.7: weaker than an exact
    match, since a coincidental near-collision is more plausible than a coincidental exact one.
  - coordinated_timing / shared_promo: time-decayed - two transactions closer together within
    the window score higher than two near its edge, scaled into a fixed band per signal type so
    neither can alone reach the ceiling shared_address/shared_payment occupy.
"""

from __future__ import annotations

import itertools
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Callable

import networkx as nx

# Heuristic constants (Rules.md Principle 5: these are judgment calls, not fitted parameters -
# tuning them against real chargeback outcomes is future work, not this phase's job).
COORDINATED_TIMING_WINDOW = timedelta(minutes=10)
SHARED_PROMO_WINDOW = timedelta(hours=24)

ADDRESS_CONFIDENCE = 0.90
PAYMENT_CONFIDENCE = 0.85
PHONE_PATTERN_CONFIDENCE = 0.70
TIMING_CONFIDENCE_FLOOR = 0.50
TIMING_CONFIDENCE_CEILING = 0.95
PROMO_CONFIDENCE_FLOOR = 0.40
PROMO_CONFIDENCE_CEILING = 0.80


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _add_signal(g: nx.Graph, a: str, b: str, signal_type: str, confidence: float) -> None:
    """Adds (or strengthens) one labeled signal on the edge a-b. Never creates an unlabeled edge -
    every call site names a real signal_type (Rules.md Principle 9)."""
    if a == b:
        return
    confidence = round(min(max(confidence, 0.0), 1.0), 2)
    if not g.has_edge(a, b):
        g.add_edge(a, b, signals=[], weight=0.0)
    edge = g[a][b]
    existing = next((s for s in edge["signals"] if s["signal_type"] == signal_type), None)
    if existing is None:
        edge["signals"].append({"signal_type": signal_type, "confidence": confidence})
        edge["weight"] += confidence
    elif confidence > existing["confidence"]:
        edge["weight"] += confidence - existing["confidence"]
        existing["confidence"] = confidence


def _group_by(accounts: list[dict], key_fn: Callable[[dict], str | None]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for acc in accounts:
        key = key_fn(acc)
        if not key:
            continue
        groups[key].append(acc["id"])
    return groups


def _add_exact_match_signals(
    g: nx.Graph, accounts: list[dict], key_fn: Callable[[dict], str | None], signal_type: str, confidence: float
) -> None:
    for _, ids in _group_by(accounts, key_fn).items():
        if len(ids) < 2:
            continue
        for a, b in itertools.combinations(sorted(ids), 2):
            _add_signal(g, a, b, signal_type, confidence)


def _add_phone_pattern_signals(g: nx.Graph, accounts: list[dict]) -> None:
    # Same phone number on every digit but the last: the sequential disposable-block pattern.
    _add_exact_match_signals(
        g, accounts, lambda acc: (acc.get("phone_number") or "")[:-1] or None, "shared_phone_pattern",
        PHONE_PATTERN_CONFIDENCE,
    )


def _sweep_time_windows(
    events: list[tuple[datetime, str]], window: timedelta, floor: float, ceiling: float, signal_type: str, g: nx.Graph
) -> None:
    """Finds account pairs with transactions close together in time. A *single* coincidental
    near-simultaneous transaction between two otherwise-unrelated accounts turns out to be common
    noise at real-world data volumes (verified against Phase 1's own dataset: hundreds of
    one-off pairs, a literal handful of pairs that repeat) - so this only signals on a pair once
    they've co-occurred within the window at least twice. That is a real, inspectable pattern
    (repeated coordination), not a threshold picked to hit a target score."""
    events = sorted(events, key=lambda e: e[0])
    n = len(events)
    window_seconds = window.total_seconds()
    best_delta: dict[tuple[str, str], float] = {}
    hit_count: dict[tuple[str, str], int] = defaultdict(int)
    for i in range(n):
        t_i, acc_i = events[i]
        j = i + 1
        while j < n:
            t_j, acc_j = events[j]
            delta = (t_j - t_i).total_seconds()
            if delta > window_seconds:
                break
            if acc_j != acc_i:
                key = tuple(sorted([acc_i, acc_j]))
                hit_count[key] += 1
                if key not in best_delta or delta < best_delta[key]:
                    best_delta[key] = delta
            j += 1

    min_corroborating_hits = 2
    for key, count in hit_count.items():
        if count < min_corroborating_hits:
            continue
        delta = best_delta[key]
        closeness = 1.0 - (delta / window_seconds) if window_seconds else 1.0
        confidence = floor + (ceiling - floor) * closeness
        a, b = key
        _add_signal(g, a, b, signal_type, confidence)


def _add_timing_signals(g: nx.Graph, transactions: list[dict]) -> None:
    events = [(_parse_dt(t["created_at"]), t["account_id"]) for t in transactions]
    _sweep_time_windows(
        events, COORDINATED_TIMING_WINDOW, TIMING_CONFIDENCE_FLOOR, TIMING_CONFIDENCE_CEILING, "coordinated_timing", g
    )


def _add_promo_signals(g: nx.Graph, transactions: list[dict]) -> None:
    by_promo: dict[str, list[tuple[datetime, str]]] = defaultdict(list)
    for t in transactions:
        promo = t.get("promo_code")
        if not promo:
            continue
        by_promo[promo].append((_parse_dt(t["created_at"]), t["account_id"]))
    for events in by_promo.values():
        _sweep_time_windows(
            events, SHARED_PROMO_WINDOW, PROMO_CONFIDENCE_FLOOR, PROMO_CONFIDENCE_CEILING, "shared_promo", g
        )


def build_graph(accounts: list[dict], transactions: list[dict]) -> nx.Graph:
    g = nx.Graph()
    for acc in accounts:
        g.add_node(acc["id"])

    _add_exact_match_signals(g, accounts, lambda acc: acc.get("delivery_address"), "shared_address", ADDRESS_CONFIDENCE)
    _add_exact_match_signals(
        g, accounts, lambda acc: acc.get("payment_method_fingerprint"), "shared_payment", PAYMENT_CONFIDENCE
    )
    _add_phone_pattern_signals(g, accounts)
    _add_timing_signals(g, transactions)
    _add_promo_signals(g, transactions)

    return g
