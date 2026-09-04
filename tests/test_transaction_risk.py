"""Lightweight test coverage for transaction_risk.py (Phase 4). Not the tdd-mandated
suite (the project's tdd guidance names test_clustering.py/test_cluster_scorer.py specifically), but
the same discipline applies: assert the two shapes this module actually needs to distinguish
before trusting its output.

Run from the repo root: python3 -m unittest tests.test_transaction_risk -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "detector-service"))

import transaction_risk  # noqa: E402


def _txn(txn_id: str, account_id: str, amount_paise: int, at: datetime, promo_code: str | None = None) -> dict:
    return {
        "id": txn_id,
        "account_id": account_id,
        "amount_paise": amount_paise,
        "promo_code": promo_code,
        "created_at": at.isoformat().replace("+00:00", "Z"),
    }


class TestTransactionRisk(unittest.TestCase):
    def test_new_account_burst_of_large_transactions_scores_high(self) -> None:
        created = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
        account = {"id": "acc_1", "created_at": created.isoformat().replace("+00:00", "Z")}
        # Account created, then immediately (minutes later) three large transactions in a burst -
        # exactly the amount-anomaly + velocity + new-account pattern this module exists to catch.
        txns = [
            _txn("t1", "acc_1", 45000, created + timedelta(minutes=5)),
            _txn("t2", "acc_1", 48000, created + timedelta(minutes=7)),
            _txn("t3", "acc_1", 50000, created + timedelta(minutes=9)),
        ]
        result = transaction_risk.score_transaction(txns[2], account, txns)
        self.assertGreaterEqual(result["risk_score"], 0.6)

    def test_established_account_isolated_ordinary_transaction_scores_low(self) -> None:
        created = datetime(2026, 1, 1, tzinfo=timezone.utc)
        account = {"id": "acc_2", "created_at": created.isoformat().replace("+00:00", "Z")}
        txns = [
            _txn("t1", "acc_2", 20000, created + timedelta(days=10)),
            _txn("t2", "acc_2", 22000, created + timedelta(days=40)),
            _txn("t3", "acc_2", 21000, created + timedelta(days=90)),
        ]
        result = transaction_risk.score_transaction(txns[2], account, txns)
        self.assertLess(result["risk_score"], 0.3)

    def test_risk_score_is_bounded_and_heuristic(self) -> None:
        created = datetime(2026, 6, 1, tzinfo=timezone.utc)
        account = {"id": "acc_3", "created_at": created.isoformat().replace("+00:00", "Z")}
        txns = [_txn("t1", "acc_3", 30000, created + timedelta(minutes=1))]
        result = transaction_risk.score_transaction(txns[0], account, txns)
        self.assertGreaterEqual(result["risk_score"], 0.0)
        self.assertLessEqual(result["risk_score"], 1.0)
        self.assertEqual(result["scoring_method"], "heuristic")


if __name__ == "__main__":
    unittest.main()
