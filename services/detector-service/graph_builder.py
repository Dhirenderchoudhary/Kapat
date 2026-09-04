"""Builds the account signal graph (Architecture.md §2.1).

Phase 2. Deliberately does NOT read account_links: in production those rows would
not exist yet - they are what this module's output eventually populates. Here they'd also be the
generator's ground truth for account grouping, so reading them would be scoring this detector
against an answer key handed to it (the "don't train the evaluation on the same synthetic
batch" spirit, applied one level down: don't detect signals by reading the generator's answer key
either). Every signal below is instead re-derived independently from the same raw fields a real
detector would have: accounts.delivery_address / payment_method_fingerprint / phone_number, and
transactions.created_at / promo_code.

Nodes: accounts (accounts.id).
Edges: one per shared signal between two accounts, each carrying a signal_type and a confidence
in [0, 1] - never an unlabeled edge (Principle 9). signal_type is one of:
shared_address | shared_payment | shared_phone_pattern | coordinated_timing | shared_promo
(matches the account_links.signal_type check constraint in packages/db/src/schema/fraud.ts).
An edge with more than one signal_type keeps every one of them in its "signals" list - a ring
sharing five signal types is stronger evidence than one sharing one, and that must stay visible,
not get collapsed into a single opaque number.

Confidence values below are fixed heuristic constants, not a calibrated model (the governing principles
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

# Heuristic constants (Principle 5: these are judgment calls, not fitted parameters -
# tuning them against real chargeback outcomes is future work, not this phase's job).
COORDINATED_TIMING_WINDOW = timedelta(minutes=10)
SHARED_PROMO_WINDOW = timedelta(hours=24)

# Above this many accounts sharing one address, card fingerprint or phone prefix, the shared value
# stops being evidence about any particular pair. See _add_exact_match_signals for the full
# reasoning and for the cost this also bounds.
MAX_SHARED_KEY_GROUP = 50

ADDRESS_CONFIDENCE = 0.90
PAYMENT_CONFIDENCE = 0.85
PHONE_PATTERN_CONFIDENCE = 0.70
TIMING_CONFIDENCE_FLOOR = 0.50
TIMING_CONFIDENCE_CEILING = 0.95
PROMO_CONFIDENCE_FLOOR = 0.40
PROMO_CONFIDENCE_CEILING = 0.80


def normalize_address(value: str | None) -> str | None:
    """Fold an address to a comparison key, so two spellings of one doorstep match.

    `shared_address` is the highest-confidence signal in the graph and it is derived by exact
    string equality. On synthetic data that is free, because the generator emits one canonical
    string per address and every account at that address carries it character for character. Real
    checkout data does not behave that way at all: "Flat 101, Block 3, Andheri, Mumbai 400053",
    "flat 101 block 3, andheri, mumbai - 400053" and the same line with a trailing space are one
    address typed by three people, and exact matching sees three unrelated accounts. The signal
    that is supposed to be the strongest in the system would quietly stop firing on the traffic it
    was built for, and nothing in the synthetic evaluation can catch that.

    The folding is deliberately conservative, because over-normalising is the opposite failure: it
    merges genuinely different addresses and manufactures links between strangers. Case, runs of
    whitespace, and punctuation used as separators are noise in every address. Flat and block
    NUMBERS are not, so nothing here touches digits or reorders components. Two different flats in
    one building stay two different addresses.

    Architecture.md 2.1 has always described this signal as "exact or fuzzy-matched". This is the
    conservative end of that: normalised-exact, not fuzzy. Real fuzzy matching against a postal
    database is future work and needs real data to tune against.
    """
    if not value:
        return None
    folded = value.casefold()
    # Separator punctuation becomes a space; anything else that is not alphanumeric is dropped.
    folded = "".join(" " if ch in ",.-/#" else ch for ch in folded if ch.isalnum() or ch in ",.-/# 	")
    collapsed = " ".join(folded.split())
    return collapsed or None


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _add_signal(g: nx.Graph, a: str, b: str, signal_type: str, confidence: float) -> None:
    """Adds (or strengthens) one labeled signal on the edge a-b. Never creates an unlabeled edge -
    every call site names a real signal_type (Principle 9)."""
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
        if len(ids) > MAX_SHARED_KEY_GROUP:
            # Two reasons, and the domain one matters more than the performance one.
            #
            # Evidence: a value shared by this many accounts is not evidence of a relationship
            # between any two of them. It is a hostel, an office block, a mail-forwarding service,
            # a corporate card, a placeholder the checkout filled in - exactly the false-positive
            # sources named in cluster_scorer.py's docstring. Linking every pair inside it asserts
            # a connection between strangers who happen to share a building.
            #
            # Cost: this is a complete graph, so the group generates n*(n-1)/2 edges. 500 accounts
            # at one address is 124,750 of them, built on every payment because the webhook path
            # re-runs detection over everything ingested so far. The largest group in any committed
            # dataset is 9, so this bound changes no published number; it exists for the real
            # merchant traffic where a shared warehouse address is ordinary.
            continue
        for a, b in itertools.combinations(sorted(ids), 2):
            _add_signal(g, a, b, signal_type, confidence)


def _add_phone_pattern_signals(g: nx.Graph, accounts: list[dict]) -> None:
    # Same phone number on every digit but the last: the sequential disposable-block pattern.
    _add_exact_match_signals(
        g, accounts, lambda acc: (acc.get("phone_number") or "")[:-1] or None, "shared_phone_pattern",
        PHONE_PATTERN_CONFIDENCE,
    )


def _count_occasions(times: list[float], window_seconds: float) -> int:
    """How many separate bursts these observation times represent.

    Observations within one window of the previous one belong to the same occasion; a gap larger
    than the window starts a new one. Used to distinguish "these two accounts ordered together on
    three different days" (a pattern) from "these two accounts each placed four items in one
    basket at the same time" (one event, and a thing households do).
    """
    if not times:
        return 0
    ordered = sorted(times)
    occasions = 1
    previous = ordered[0]
    for current in ordered[1:]:
        if current - previous > window_seconds:
            occasions += 1
        previous = current
    return occasions


def _sweep_time_windows(
    events: list[tuple[datetime, str]], window: timedelta, floor: float, ceiling: float, signal_type: str, g: nx.Graph
) -> None:
    """Finds account pairs with transactions close together in time. A *single* coincidental
    near-simultaneous transaction between two otherwise-unrelated accounts turns out to be common
    noise at real-world data volumes (verified against Phase 1's own dataset: hundreds of
    one-off pairs, a literal handful of pairs that repeat) - so this only signals on a pair once
    they've co-occurred on at least two SEPARATE occasions. That is a real, inspectable pattern
    (repeated coordination), not a threshold picked to hit a target score.

    "Separate occasions" is the part that needs saying precisely, because the obvious
    implementation gets it wrong. Counting matching transaction PAIRS does not measure repetition:
    two accounts that each place three transactions during one shopping session produce up to nine
    pairs from a single co-occurrence, sailing past a two-hit floor on one event. That is exactly
    the coincidence the floor exists to reject, and it is ordinary behaviour for a household
    ordering together once. So the observations for a pair are collected, sorted, and grouped into
    bursts - consecutive observations more than one window apart start a new burst - and it is
    BURSTS that must reach the floor. One long session is one occasion no matter how many
    transactions it contains."""
    events = sorted(events, key=lambda e: e[0])
    n = len(events)
    window_seconds = window.total_seconds()
    best_delta: dict[tuple[str, str], float] = {}
    observed_at: dict[tuple[str, str], list[float]] = defaultdict(list)
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
                observed_at[key].append(t_i.timestamp())
                if key not in best_delta or delta < best_delta[key]:
                    best_delta[key] = delta
            j += 1

    min_corroborating_occasions = 2
    for key, times in observed_at.items():
        if _count_occasions(times, window_seconds) < min_corroborating_occasions:
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

    _add_exact_match_signals(
        g, accounts, lambda acc: normalize_address(acc.get("delivery_address")), "shared_address",
        ADDRESS_CONFIDENCE,
    )
    _add_exact_match_signals(
        g, accounts, lambda acc: acc.get("payment_method_fingerprint"), "shared_payment", PAYMENT_CONFIDENCE
    )
    _add_phone_pattern_signals(g, accounts)
    _add_timing_signals(g, transactions)
    _add_promo_signals(g, transactions)

    return g
