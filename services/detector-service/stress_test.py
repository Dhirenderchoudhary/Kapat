"""Adversarial stress test: where does this detector actually break?

The held-out split (evaluate.py) reports 100% precision / 100% recall, and quoting that number
without this file next to it would be misleading. The look-alike households in
generate_synthetic_data.py are EASY: they share exactly one thing (a delivery address). Real
households are messier - they share a family card, they order dinner at the same time, they pass
the same coupon around a WhatsApp group. And real fraud rings are not obliged to be sloppy: a
careful ring uses different addresses and different cards.

This script builds those harder populations on purpose and reports, honestly, which ones the
detector gets right and which ones it gets wrong. Cases it fails are listed as failures, not
explained away. The point is to find the decision boundary and state it, so the reported headline
numbers are read with the right amount of trust.

Nothing here is used to tune the detector - it is a report, run after the fact. The threshold
still comes from select_threshold.py on the train split.

Usage: python3 stress_test.py
"""

from __future__ import annotations

import json
import random
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import cluster_scorer
import clustering
import graph_builder
from generate_synthetic_data import (
    BASE_TIME,
    PROMO_CODES,
    make_account,
    make_transaction,
    synthetic_address,
    synthetic_payment_fingerprint,
    synthetic_phone,
    synthetic_phone_block,
)

OUTPUT_PATH = Path(__file__).resolve().parents[2] / "data" / "stress_test_report.json"


def _co_transactions(rng, ids, *, promo, n_bursts, spread_minutes, base_offset_days):
    """Emits transactions that fire together n_bursts times inside spread_minutes. graph_builder
    needs at least 2 co-occurrences inside its window before it will signal coordinated_timing or
    shared_promo, so n_bursts controls whether those signals fire at all."""
    txns = []
    for burst in range(n_bursts):
        window_start = BASE_TIME - timedelta(days=base_offset_days + burst * 3)
        for aid in ids:
            at = window_start + timedelta(minutes=rng.uniform(0, spread_minutes))
            txns.append(make_transaction(rng, aid, at=at, promo_code=promo))
    return txns


def build_case(name, *, rng, size, expectation, note,
               share_address=False, share_payment=False, sequential_phones=False,
               coordinated=False, share_promo=False, n_bursts=3):
    """Builds one adversarial population and returns (case_meta, accounts, transactions, ids)."""
    address = synthetic_address(rng)
    payment = synthetic_payment_fingerprint(rng)
    phones = synthetic_phone_block(rng, size) if sequential_phones else [synthetic_phone(rng) for _ in range(size)]
    promo = rng.choice(PROMO_CODES)

    accounts, ids = [], []
    for i in range(size):
        acc = make_account(
            rng,
            address=address if share_address else synthetic_address(rng),
            payment_fp=payment if share_payment else synthetic_payment_fingerprint(rng),
            phone=phones[i],
        )
        accounts.append(acc)
        ids.append(acc["id"])

    transactions = []
    if coordinated or share_promo:
        transactions += _co_transactions(
            rng, ids,
            promo=promo if share_promo else None,
            n_bursts=n_bursts,
            spread_minutes=4 if coordinated else 600,
            base_offset_days=20,
        )
    # Everyone also has ordinary, unrelated activity.
    for aid in ids:
        for _ in range(2):
            at = BASE_TIME - timedelta(days=rng.randint(1, 55), hours=rng.randint(0, 23))
            transactions.append(make_transaction(rng, aid, at=at, promo_code=None))

    return (
        {"case": name, "size": size, "expectation": expectation, "note": note},
        accounts,
        transactions,
        ids,
    )


CASES = [
    # ---- Legitimate populations that should NOT be flagged, in increasing difficulty ----
    dict(name="household_address_only", size=3, expectation="not_flagged",
         note="Baseline household. Shares a delivery address, nothing else. The easy case the main test set uses.",
         share_address=True),
    dict(name="household_address_and_card", size=3, expectation="not_flagged",
         note="Very common real household: one delivery address and one family card. Two benign signals, no fraud-specific ones.",
         share_address=True, share_payment=True),
    dict(name="household_shares_card_and_orders_together", size=3, expectation="not_flagged",
         note="HARD. Family that shares an address AND a card AND repeatedly orders within minutes of each other. Fully dense graph, three overlaps. Exactly the case the ceiling rule exists for.",
         share_address=True, share_payment=True, coordinated=True),
    dict(name="flatmates_pass_around_one_coupon", size=3, expectation="not_flagged",
         note="HARDEST legitimate case. Flatmates share an address and a card, order together, AND pass one promo code around. Indistinguishable from promo abuse on the signals available.",
         share_address=True, share_payment=True, coordinated=True, share_promo=True),

    # ---- Fraud rings that SHOULD be flagged, in increasing evasiveness ----
    dict(name="ring_textbook", size=5, expectation="flagged",
         note="Textbook ring: every signal fires. What the main test set contains.",
         share_address=True, share_payment=True, sequential_phones=True, coordinated=True, share_promo=True),
    dict(name="ring_distinct_addresses", size=5, expectation="flagged",
         note="Evasive ring: uses different delivery addresses, but still one card, sequential SIM block, coordinated timing, one promo.",
         share_payment=True, sequential_phones=True, coordinated=True, share_promo=True),
    dict(name="ring_no_shared_address_or_card", size=5, expectation="flagged",
         note="More evasive: different addresses AND different cards. Only the SIM block, timing and promo reuse remain.",
         sequential_phones=True, coordinated=True, share_promo=True),
    dict(name="ring_promo_abuse_only", size=4, expectation="flagged",
         note="Pure promo-abuse ring: no shared address, no shared card, ordinary phone numbers. Only coordinated timing + one promo funnelled through all accounts.",
         coordinated=True, share_promo=True),
    dict(name="ring_burner_sims_only", size=4, expectation="flagged",
         note="Sequential SIM block and nothing else - no shared address, card, timing or promo.",
         sequential_phones=True),
    dict(name="ring_maximally_evasive", size=4, expectation="flagged",
         note="Hardest ring: coordinated timing only. Different addresses, cards, phones, no promo reuse. Deliberately at the edge of what these five signals can see at all.",
         coordinated=True),
]


def main() -> None:
    results = []
    for case_spec in CASES:
        rng = random.Random(hash(case_spec["name"]) % (2**31))
        spec = dict(case_spec)
        name = spec.pop("name")
        size = spec.pop("size")
        expectation = spec.pop("expectation")
        note = spec.pop("note")

        meta, accounts, transactions, ids = build_case(
            name, rng=rng, size=size, expectation=expectation, note=note, **spec
        )

        graph = graph_builder.build_graph(accounts, transactions)
        # Score the intended group directly. Clustering is exercised separately in evaluate.py;
        # this file is specifically about whether the SCORER draws the right line, so it must not
        # be confounded by whether Louvain happened to group these accounts as one community.
        score = cluster_scorer.score_cluster(graph, set(ids), accounts=accounts, transactions=transactions)

        flagged = score["flagged"]
        correct = (flagged and expectation == "flagged") or (not flagged and expectation == "not_flagged")
        results.append(
            {
                **meta,
                "risk_score": score["risk_score"],
                "raw_risk_score": score["raw_risk_score"],
                "ceiling_applied": score["ceiling_applied"],
                "signal_types_present": score["features"]["signal_types_present"],
                "flagged": flagged,
                "correct": correct,
                "explanation": score["explanation"],
            }
        )

    n_correct = sum(1 for r in results if r["correct"])
    failures = [r for r in results if not r["correct"]]

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "flag_threshold": cluster_scorer.FLAG_THRESHOLD,
        "n_cases": len(results),
        "n_correct": n_correct,
        "n_failures": len(failures),
        "results": results,
        "purpose": (
            "Adversarial companion to evaluate.py. The main held-out split contains only easy "
            "look-alikes (one shared signal); these cases are deliberately harder on both sides. "
            "Failures here are the detector's real decision boundary and are reported as failures."
        ),
    }
    OUTPUT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print(f"Adversarial stress test - threshold {cluster_scorer.FLAG_THRESHOLD}\n")
    print(f"{'case':<42} {'expect':<12} {'score':>7} {'flag':>6} {'result':>8}")
    print("-" * 82)
    for r in results:
        print(f"{r['case']:<42} {r['expectation']:<12} {r['risk_score']:>7} "
              f"{str(r['flagged']):>6} {'OK' if r['correct'] else 'FAIL':>8}")
    print(f"\n{n_correct}/{len(results)} correct.")
    if failures:
        print(f"\n{len(failures)} FAILURE(S) - the detector's real limits:")
        for f in failures:
            print(f"\n  {f['case']} (expected {f['expectation']}, scored {f['risk_score']})")
            print(f"    signals present: {', '.join(f['signal_types_present']) or 'none'}")
            print(f"    {f['note']}")
    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
