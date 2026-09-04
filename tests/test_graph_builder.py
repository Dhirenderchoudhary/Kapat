"""Signal-derivation tests for services/detector-service/graph_builder.py.

Focused on the two-occasion floor for coordinated_timing and shared_promo, because that rule is
easy to implement in a way that looks right, passes every test drawn from the synthetic generator,
and is still wrong on real traffic.

The generator emits exactly one transaction per account per burst, so it can never tell a pair
that co-occurred on three separate days apart from a pair that placed several items during one
shared session. Real merchant traffic is full of the second. These tests encode the distinction
directly, independent of the generator.

Run from the repo root: python3 -m unittest tests.test_graph_builder -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "detector-service"))

import graph_builder  # noqa: E402

BASE = datetime(2026, 6, 1, tzinfo=timezone.utc)
ACCOUNTS = [
    {"id": "acc_a", "created_at": BASE.isoformat()},
    {"id": "acc_b", "created_at": BASE.isoformat()},
]


def txn(account_id: str, minutes: float, promo: str | None = None) -> dict:
    return {
        "id": f"txn_{account_id}_{minutes}",
        "account_id": account_id,
        "amount_paise": 120_000,
        "promo_code": promo,
        "created_at": (BASE + timedelta(minutes=minutes)).isoformat(),
    }


def signals(transactions: list[dict]) -> set[str]:
    graph = graph_builder.build_graph(ACCOUNTS, transactions)
    return {
        signal["signal_type"]
        for _a, _b, data in graph.edges(data=True)
        for signal in data["signals"]
    }


class TestCoordinatedTimingNeedsSeparateOccasions(unittest.TestCase):
    def test_one_shared_session_with_many_transactions_does_not_signal(self) -> None:
        """Two people placing several orders each during one evening is a household, not a ring.

        Counting matching transaction PAIRS instead of occasions would find nine pairs here and
        clear a two-hit floor on the strength of a single co-occurrence.
        """
        one_session = [
            txn("acc_a", 0),
            txn("acc_a", 1),
            txn("acc_a", 2),
            txn("acc_b", 1),
            txn("acc_b", 2),
            txn("acc_b", 3),
        ]
        self.assertNotIn("coordinated_timing", signals(one_session))

    def test_two_separate_occasions_do_signal(self) -> None:
        """Ordering together, then again three days later, is the repetition the rule is after."""
        two_occasions = [
            txn("acc_a", 0),
            txn("acc_b", 1),
            txn("acc_a", 3 * 24 * 60),
            txn("acc_b", 3 * 24 * 60 + 1),
        ]
        self.assertIn("coordinated_timing", signals(two_occasions))

    def test_a_single_near_simultaneous_pair_does_not_signal(self) -> None:
        """One coincidental collision between strangers is common noise at real volumes."""
        self.assertNotIn("coordinated_timing", signals([txn("acc_a", 0), txn("acc_b", 1)]))


class TestSharedPromoNeedsSeparateOccasions(unittest.TestCase):
    def test_one_promo_session_does_not_signal(self) -> None:
        """Same widening applies to promo reuse: one shared checkout is one observation."""
        one_session = [
            txn("acc_a", 0, promo="WELCOME50"),
            txn("acc_a", 30, promo="WELCOME50"),
            txn("acc_b", 15, promo="WELCOME50"),
            txn("acc_b", 45, promo="WELCOME50"),
        ]
        self.assertNotIn("shared_promo", signals(one_session))

    def test_promo_reused_on_separate_days_signals(self) -> None:
        day = 24 * 60
        two_occasions = [
            txn("acc_a", 0, promo="WELCOME50"),
            txn("acc_b", 60, promo="WELCOME50"),
            txn("acc_a", 5 * day, promo="WELCOME50"),
            txn("acc_b", 5 * day + 60, promo="WELCOME50"),
        ]
        self.assertIn("shared_promo", signals(two_occasions))


class TestExactMatchSignals(unittest.TestCase):
    def test_shared_address_and_payment_are_labeled_with_confidence(self) -> None:
        """Every edge carries its signal_type and confidence - never an unlabeled connection."""
        accounts = [
            {"id": "acc_a", "delivery_address": "12 MG Road", "payment_method_fingerprint": "visa_4242", "created_at": BASE.isoformat()},
            {"id": "acc_b", "delivery_address": "12 MG Road", "payment_method_fingerprint": "visa_4242", "created_at": BASE.isoformat()},
        ]
        graph = graph_builder.build_graph(accounts, [txn("acc_a", 0), txn("acc_b", 500)])
        found = {s["signal_type"]: s["confidence"] for _a, _b, d in graph.edges(data=True) for s in d["signals"]}
        self.assertEqual(found["shared_address"], graph_builder.ADDRESS_CONFIDENCE)
        self.assertEqual(found["shared_payment"], graph_builder.PAYMENT_CONFIDENCE)

    def test_sequential_phone_block_signals_but_unrelated_numbers_do_not(self) -> None:
        sequential = [
            {"id": "acc_a", "phone_number": "+919876543210", "created_at": BASE.isoformat()},
            {"id": "acc_b", "phone_number": "+919876543211", "created_at": BASE.isoformat()},
        ]
        unrelated = [
            {"id": "acc_a", "phone_number": "+919876543210", "created_at": BASE.isoformat()},
            {"id": "acc_b", "phone_number": "+918123456789", "created_at": BASE.isoformat()},
        ]
        txns = [txn("acc_a", 0), txn("acc_b", 500)]
        self.assertIn(
            "shared_phone_pattern",
            {s["signal_type"] for _a, _b, d in graph_builder.build_graph(sequential, txns).edges(data=True) for s in d["signals"]},
        )
        self.assertEqual(graph_builder.build_graph(unrelated, txns).number_of_edges(), 0)


if __name__ == "__main__":
    unittest.main()
