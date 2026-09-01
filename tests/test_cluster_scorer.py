"""Rules.md tdd guidance: written before cluster_scorer.py has real logic, test-first, mirroring
tests/test_clustering.py's fixture so both suites reason about the same accounts.

Directly encodes Rules.md's own example wording: "a synthetic ring of 4 accounts clusters
together, and a synthetic legitimate shared-household pair does *not* get flagged at high
confidence."

Run from the repo root: python3 -m unittest tests.test_cluster_scorer -v
"""

from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "detector-service"))

import graph_builder  # noqa: E402
import cluster_scorer  # noqa: E402
from generate_synthetic_data import (  # noqa: E402
    Dataset,
    generate_baseline_account,
    generate_legitimate_lookalike,
    generate_true_ring,
)

# A cluster this low can't be a coordinated ring - keeps the "high confidence" bar meaningful
# rather than picking a number that happens to fit today's formula.
HIGH_CONFIDENCE_FLOOR = 0.6


class TestClusterScorer(unittest.TestCase):
    def setUp(self) -> None:
        rng = random.Random(7)
        self.ds = Dataset()
        self.ring_ids = generate_true_ring(self.ds, rng, 0, size=4)
        self.lookalike_ids = generate_legitimate_lookalike(self.ds, rng, 0, size=2)
        for _ in range(20):
            generate_baseline_account(self.ds, rng)
        self.graph = graph_builder.build_graph(self.ds.accounts, self.ds.transactions)
        self.ring_result = cluster_scorer.score_cluster(self.graph, set(self.ring_ids))
        self.lookalike_result = cluster_scorer.score_cluster(self.graph, set(self.lookalike_ids))

    def test_true_ring_scores_high_confidence(self) -> None:
        self.assertGreaterEqual(self.ring_result["risk_score"], HIGH_CONFIDENCE_FLOOR)

    def test_lookalike_pair_does_not_score_high_confidence(self) -> None:
        self.assertLess(self.lookalike_result["risk_score"], HIGH_CONFIDENCE_FLOOR)

    def test_ring_scores_meaningfully_higher_than_lookalike(self) -> None:
        # The comparative claim Rules.md actually cares about, independent of exact thresholds.
        self.assertGreater(self.ring_result["risk_score"], self.lookalike_result["risk_score"])

    def test_risk_score_is_bounded(self) -> None:
        for result in (self.ring_result, self.lookalike_result):
            self.assertGreaterEqual(result["risk_score"], 0.0)
            self.assertLessEqual(result["risk_score"], 1.0)

    def test_evidence_is_real_and_traceable(self) -> None:
        # Principle 9: every piece of evidence names a real signal_type and the actual accounts
        # it came from - never an opaque number.
        evidence = self.ring_result["evidence"]
        self.assertTrue(evidence, "a 4-account true ring produced no evidence at all")
        for item in evidence:
            self.assertIn("signal_type", item)
            self.assertIn("accounts_involved", item)
            self.assertIn("confidence", item)
            self.assertTrue(0 <= item["confidence"] <= 1)
            for acc in item["accounts_involved"]:
                self.assertIn(acc, self.ring_ids)

    def test_score_notes_it_is_a_heuristic_not_a_calibrated_model(self) -> None:
        # Rules.md Principle 5: no fabricated confidence - the output must say plainly that this
        # is a hand-built heuristic, not a trained/calibrated probability.
        self.assertIn("scoring_method", self.ring_result)
        self.assertEqual(self.ring_result["scoring_method"], "heuristic")


if __name__ == "__main__":
    unittest.main()


class TestCorroborationGating(unittest.TestCase):
    """Phase 10 (Memory.md decision 25): the ceiling rule that fixed precision from 41.7% to 100%
    on the held-out split. These tests pin down the BEHAVIOUR that fix depends on, so a future
    change to the weights can't silently undo it while leaving the older, looser tests green.

    Each case builds accounts/transactions directly rather than via generate_synthetic_data.py's
    ring/lookalike helpers, because the whole point is to construct populations those helpers
    deliberately don't produce - notably households that share MORE than one signal.
    """

    def setUp(self) -> None:
        self.rng = random.Random(11)

    def _score(self, accounts, transactions, ids):
        graph = graph_builder.build_graph(accounts, transactions)
        return cluster_scorer.score_cluster(graph, set(ids))

    def _household(self, *, size, share_payment, coordinated):
        """A legitimate household. Always shares a delivery address; optionally also a family card
        and a habit of ordering at the same time. Never has a sequential phone block or a funnelled
        promo code - those are the things a household genuinely does not do."""
        from generate_synthetic_data import (
            BASE_TIME,
            make_account,
            make_transaction,
            synthetic_address,
            synthetic_payment_fingerprint,
            synthetic_phone,
        )
        from datetime import timedelta

        address = synthetic_address(self.rng)
        shared_card = synthetic_payment_fingerprint(self.rng)
        accounts, ids = [], []
        for _ in range(size):
            acc = make_account(
                self.rng,
                address=address,
                payment_fp=shared_card if share_payment else synthetic_payment_fingerprint(self.rng),
                phone=synthetic_phone(self.rng),
            )
            accounts.append(acc)
            ids.append(acc["id"])

        transactions = []
        if coordinated:
            # Ordering together repeatedly - graph_builder needs 2+ co-occurrences before it
            # signals coordinated_timing at all, so this genuinely fires the signal.
            for burst in range(3):
                start = BASE_TIME - timedelta(days=10 + burst * 3)
                for aid in ids:
                    transactions.append(
                        make_transaction(self.rng, aid, at=start + timedelta(minutes=self.rng.uniform(0, 4)), promo_code=None)
                    )
        for aid in ids:
            transactions.append(
                make_transaction(self.rng, aid, at=BASE_TIME - timedelta(days=self.rng.randint(20, 50)), promo_code=None)
            )
        return accounts, transactions, ids

    def test_household_sharing_address_and_card_is_capped_and_not_flagged(self) -> None:
        # Extremely common in reality: one delivery address, one family card. Two signals, both
        # with a complete innocent explanation. The old flat-sum model scored this kind of group
        # over the line; the ceiling rule is what stops it.
        accounts, transactions, ids = self._household(size=3, share_payment=True, coordinated=False)
        result = self._score(accounts, transactions, ids)

        self.assertTrue(result["ceiling_applied"], "a benign-only household must hit the ceiling")
        self.assertLessEqual(result["risk_score"], cluster_scorer.BENIGN_ONLY_CEILING)
        self.assertFalse(result["flagged"])

    def test_hardest_legitimate_household_still_not_flagged(self) -> None:
        # The hardest legitimate case the design claims to survive: shares an address AND a card
        # AND repeatedly orders within minutes. Fully dense, three overlaps - and still capped,
        # because coordinated_timing alone is weak fraud-specific evidence and nothing strong is
        # present. This is the exact claim cluster_scorer.py's docstring makes; if it ever stops
        # holding, that docstring is a lie and this test is how we find out.
        accounts, transactions, ids = self._household(size=3, share_payment=True, coordinated=True)
        result = self._score(accounts, transactions, ids)

        self.assertIn("coordinated_timing", result["features"]["signal_types_present"])
        self.assertTrue(result["ceiling_applied"])
        self.assertFalse(result["flagged"], f"hardest legitimate household was flagged at {result['risk_score']}")

    def test_density_alone_cannot_manufacture_risk(self) -> None:
        # The specific double-counting bug being guarded against: a bigger, denser, higher-
        # confidence household must NOT climb past the ceiling just by being bigger and denser.
        small = self._score(*self._household(size=2, share_payment=True, coordinated=False))
        large = self._score(*self._household(size=6, share_payment=True, coordinated=False))

        self.assertFalse(small["flagged"])
        self.assertFalse(large["flagged"], "a larger household must not become flaggable through size/density alone")
        self.assertLessEqual(large["risk_score"], cluster_scorer.BENIGN_ONLY_CEILING)

    def test_a_real_ring_is_not_capped_and_is_flagged(self) -> None:
        ds = Dataset()
        ring_ids = generate_true_ring(ds, self.rng, 0, size=4)
        graph = graph_builder.build_graph(ds.accounts, ds.transactions)
        result = cluster_scorer.score_cluster(graph, set(ring_ids))

        self.assertFalse(result["ceiling_applied"], "a ring with strong fraud-specific signals must not be capped")
        self.assertTrue(result["flagged"])
        self.assertTrue(set(result["features"]["strong_fraud_specific_present"]))

    def test_explanation_is_traceable_to_the_signals_that_produced_it(self) -> None:
        # Principle 9 extended to the score's own explanation: it must be derived from the signals
        # actually present, not written independently of them.
        accounts, transactions, ids = self._household(size=3, share_payment=True, coordinated=False)
        result = self._score(accounts, transactions, ids)

        self.assertTrue(result["explanation"])
        joined = " ".join(result["explanation"]).lower()
        self.assertIn("capped", joined)
        self.assertIn("household", joined)

    def test_every_evidence_item_carries_its_signal_class(self) -> None:
        ds = Dataset()
        ring_ids = generate_true_ring(ds, self.rng, 0, size=3)
        graph = graph_builder.build_graph(ds.accounts, ds.transactions)
        result = cluster_scorer.score_cluster(graph, set(ring_ids))

        valid = {"benign_explainable", "weak_fraud_specific", "strong_fraud_specific"}
        self.assertTrue(result["evidence"])
        for item in result["evidence"]:
            self.assertIn(item["signal_class"], valid)

    def test_flagged_boolean_agrees_with_the_threshold(self) -> None:
        ds = Dataset()
        ring_ids = generate_true_ring(ds, self.rng, 0, size=5)
        graph = graph_builder.build_graph(ds.accounts, ds.transactions)
        result = cluster_scorer.score_cluster(graph, set(ring_ids))

        self.assertEqual(result["flagged"], result["risk_score"] >= cluster_scorer.FLAG_THRESHOLD)
        self.assertEqual(result["flag_threshold"], cluster_scorer.FLAG_THRESHOLD)
