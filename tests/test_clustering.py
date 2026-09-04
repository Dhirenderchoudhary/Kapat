"""the governing principles tdd guidance: written before graph_builder.py/clustering.py have real logic, so it
starts red and proves the implementation against Phase 2's exit criteria directly -
a true ring of 4 accounts clusters together, and a legitimate look-alike pair does not silently
merge into it.

Plain stdlib unittest, not pytest: the only genuinely new dependency this phase needs is
networkx itself (Architecture.md §4) - a test runner on top of it isn't worth adding.

Run from the repo root: python3 -m unittest tests.test_clustering -v
"""

from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "detector-service"))

import graph_builder  # noqa: E402
import clustering  # noqa: E402
from generate_synthetic_data import (  # noqa: E402
    Dataset,
    generate_baseline_account,
    generate_legitimate_lookalike,
    generate_true_ring,
)


class TestClustering(unittest.TestCase):
    def setUp(self) -> None:
        rng = random.Random(7)
        self.ds = Dataset()
        # Exact sizes, matching the original specification's example wording literally.
        self.ring_ids = generate_true_ring(self.ds, rng, 0, size=4)
        self.lookalike_ids = generate_legitimate_lookalike(self.ds, rng, 0, size=2)
        for _ in range(20):
            generate_baseline_account(self.ds, rng)
        self.graph = graph_builder.build_graph(self.ds.accounts, self.ds.transactions)
        self.clusters = clustering.find_clusters(self.graph)

    def test_true_ring_of_four_clusters_together(self) -> None:
        matching = [c for c in self.clusters if set(self.ring_ids) <= c]
        self.assertTrue(matching, "the 4-account true ring did not end up in one cluster")
        # And it shouldn't have swept in unrelated baseline accounts.
        self.assertEqual(matching[0], set(self.ring_ids))

    def test_lookalike_pair_does_not_merge_into_the_ring(self) -> None:
        ring_cluster = next(c for c in self.clusters if set(self.ring_ids) <= c)
        overlap = set(self.lookalike_ids) & ring_cluster
        self.assertFalse(overlap, f"legitimate look-alike accounts merged into the ring's cluster: {overlap}")

    def test_every_edge_within_the_ring_has_labeled_signals(self) -> None:
        # Principle 9: never an unlabeled connection.
        for a, b, data in self.graph.edges(data=True):
            if a in self.ring_ids and b in self.ring_ids:
                self.assertTrue(data["signals"], f"edge {a}-{b} has no labeled signal_type")
                for s in data["signals"]:
                    self.assertIn("signal_type", s)
                    self.assertTrue(0 <= s["confidence"] <= 1)


if __name__ == "__main__":
    unittest.main()
