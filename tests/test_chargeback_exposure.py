"""Lightweight test coverage for chargeback_exposure.py (Phase 4).

Run from the repo root: python3 -m unittest tests.test_chargeback_exposure -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "detector-service"))

import chargeback_exposure  # noqa: E402


def _txn(txn_id: str, account_id: str, amount_paise: int) -> dict:
    return {"id": txn_id, "account_id": account_id, "amount_paise": amount_paise}


class TestChargebackExposure(unittest.TestCase):
    def test_exposure_sums_only_high_risk_transactions_for_member_accounts(self) -> None:
        account_ids = ["acc_1", "acc_2"]
        transactions = [
            _txn("t1", "acc_1", 50000),  # high risk
            _txn("t2", "acc_1", 20000),  # low risk
            _txn("t3", "acc_2", 30000),  # high risk
            _txn("t4", "acc_9", 999999),  # not a member account - must never contribute
        ]
        risk_scores = {"t1": 0.9, "t2": 0.1, "t3": 0.7, "t4": 0.95}

        result = chargeback_exposure.compute_exposure(account_ids, transactions, risk_scores)

        self.assertEqual(result["exposure_paise"], 50000 + 30000)
        contributing_ids = {t["transaction_id"] for t in result["contributing_transactions"]}
        self.assertEqual(contributing_ids, {"t1", "t3"})

    def test_no_high_risk_transactions_means_zero_exposure(self) -> None:
        account_ids = ["acc_1"]
        transactions = [_txn("t1", "acc_1", 50000)]
        risk_scores = {"t1": 0.1}

        result = chargeback_exposure.compute_exposure(account_ids, transactions, risk_scores)

        self.assertEqual(result["exposure_paise"], 0)
        self.assertEqual(result["contributing_transactions"], [])

    def test_result_is_labeled_as_an_estimate_not_confirmed_chargebacks(self) -> None:
        # Principle 5: this system has no real chargeback ground truth, so the output
        # must say plainly that this is an estimate of exposure, not a report of what happened.
        result = chargeback_exposure.compute_exposure(["acc_1"], [_txn("t1", "acc_1", 1000)], {"t1": 0.9})
        self.assertIn("basis", result)
        self.assertIn("note", result)
        self.assertIn("not", result["note"].lower())


if __name__ == "__main__":
    unittest.main()
