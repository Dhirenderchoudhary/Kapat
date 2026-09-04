"""DB-level idempotency guarantees (Principle 3: "app-level checks are for
error messages, not the guarantee").

Exercises the exact SQL patterns api/hono/src/routers/webhooks.ts and clusters.ts run against
Postgres - ON CONFLICT DO NOTHING on accounts.customer_ref and transactions.razorpay_event_id
(migration 0005_account_idempotency.sql closed the accounts gap), and
the compare-and-set UPDATE ... WHERE status <> 'resolved' that makes a cluster decision
execute-at-most-once. See tests/db_test_helper.py's docstring for why this shells out to `psql`
instead of importing a Python Postgres driver, and for why these tests SKIP (not fail) without a
reachable POSTGRES_URL.

Run from the repo root: python3 -m unittest tests.test_idempotency -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db_test_helper import (  # noqa: E402
    SKIP_REASON,
    FraudSchemaSandbox,
    postgres_reachable,
)


@unittest.skipUnless(postgres_reachable(), SKIP_REASON)
class TestWebhookIdempotency(unittest.TestCase):
    """Mirrors webhooks.ts POST /webhooks/razorpay exactly: account upsert via
    ON CONFLICT (customer_ref) DO NOTHING + fallback select, then transaction insert via
    ON CONFLICT (razorpay_event_id) DO NOTHING."""

    def test_duplicate_webhook_delivery_does_not_duplicate_or_overwrite(self) -> None:
        with FraudSchemaSandbox() as sandbox:
            # First delivery: new account, new transaction.
            sandbox.q("""
                INSERT INTO accounts (id, customer_ref, delivery_address)
                VALUES ('acct_1', 'cust_1', '221B Baker St')
                ON CONFLICT (customer_ref) DO NOTHING;
                INSERT INTO transactions (id, razorpay_event_id, account_id, amount_paise)
                VALUES ('txn_1', 'evt_1', 'acct_1', 500000)
                ON CONFLICT (razorpay_event_id) DO NOTHING;
            """)

            # Second delivery: SAME event id, retried with a different amount - must be a no-op,
            # not a silent overwrite of the first transaction's amount.
            sandbox.q("""
                INSERT INTO accounts (id, customer_ref, delivery_address)
                VALUES ('acct_should_not_exist', 'cust_1', 'a different address')
                ON CONFLICT (customer_ref) DO NOTHING;
                INSERT INTO transactions (id, razorpay_event_id, account_id, amount_paise)
                VALUES ('txn_should_not_exist', 'evt_1', 'acct_1', 999999)
                ON CONFLICT (razorpay_event_id) DO NOTHING;
            """)

            accounts = sandbox.q("SELECT id, delivery_address FROM accounts WHERE customer_ref = 'cust_1'")
            self.assertEqual(accounts.stdout.strip(), "acct_1|221B Baker St")

            txns = sandbox.q("SELECT id, amount_paise FROM transactions WHERE razorpay_event_id = 'evt_1'")
            self.assertEqual(txns.stdout.strip(), "txn_1|500000")

    def test_new_event_for_same_customer_adds_a_transaction_without_duplicating_the_account(self) -> None:
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("""
                INSERT INTO accounts (id, customer_ref) VALUES ('acct_1', 'cust_1')
                ON CONFLICT (customer_ref) DO NOTHING;
                INSERT INTO transactions (id, razorpay_event_id, account_id, amount_paise)
                VALUES ('txn_1', 'evt_1', 'acct_1', 500000)
                ON CONFLICT (razorpay_event_id) DO NOTHING;
            """)
            sandbox.q("""
                INSERT INTO accounts (id, customer_ref) VALUES ('acct_2', 'cust_1')
                ON CONFLICT (customer_ref) DO NOTHING;
                INSERT INTO transactions (id, razorpay_event_id, account_id, amount_paise)
                VALUES ('txn_2', 'evt_2', 'acct_1', 150000)
                ON CONFLICT (razorpay_event_id) DO NOTHING;
            """)

            account_count = sandbox.q("SELECT count(*) FROM accounts WHERE customer_ref = 'cust_1'")
            self.assertEqual(account_count.stdout.strip(), "1")

            txn_count = sandbox.q("SELECT count(*) FROM transactions WHERE account_id = 'acct_1'")
            self.assertEqual(txn_count.stdout.strip(), "2")

    def test_bypassing_the_app_and_inserting_a_duplicate_customer_ref_directly_is_rejected(self) -> None:
        # Proves the guarantee lives in the database, not just in the app's ON CONFLICT clause -
        # exactly what Principle 3 asks for. Note: psql without -v ON_ERROR_STOP=1
        # still exits 0 even when a statement inside the script errors (verified empirically
        # against a real Postgres 16) - the error only shows up on
        # stderr, so that's what this asserts on, not the process's exit code.
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO accounts (id, customer_ref) VALUES ('acct_1', 'cust_1')")
            result = sandbox.q("INSERT INTO accounts (id, customer_ref) VALUES ('acct_2', 'cust_1')")
            self.assertIn("accounts_customer_ref_uidx", result.stderr)
            self.assertIn("duplicate key value violates unique constraint", result.stderr)
            # And the row from the first, successful insert is still there, untouched.
            count = sandbox.q("SELECT count(*) FROM accounts WHERE customer_ref = 'cust_1'")
            self.assertEqual(count.stdout.strip(), "1")


@unittest.skipUnless(postgres_reachable(), SKIP_REASON)
class TestDecisionIdempotency(unittest.TestCase):
    """Mirrors clusters.ts POST /:id/decision's compare-and-set: UPDATE clusters SET status = ...
    WHERE id = :id AND status <> 'resolved' RETURNING status. A cluster that already has a final
    decision cannot be decided again - the WHERE clause is the guarantee, not an app-level
    read-then-write check that a concurrent request could race past."""

    def test_second_decision_after_resolution_updates_zero_rows(self) -> None:
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO clusters (id, risk_score) VALUES ('cl_1', 0.8)")

            first = sandbox.q(
                "UPDATE clusters SET status = 'resolved' WHERE id = 'cl_1' AND status <> 'resolved' RETURNING status"
            )
            self.assertEqual(first.stdout.strip(), "resolved")

            second = sandbox.q(
                "UPDATE clusters SET status = 'resolved' WHERE id = 'cl_1' AND status <> 'resolved' RETURNING status"
            )
            self.assertEqual(second.stdout.strip(), "")  # no row returned - nothing updated

    def test_escalate_leaves_cluster_open_for_a_later_final_decision(self) -> None:
        # escalate moves status to pending_review (Design.md §1.2, verification Flow C), which is
        # NOT "resolved" - a later freeze/block/dismiss on the same cluster must still succeed.
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO clusters (id, risk_score) VALUES ('cl_1', 0.8)")

            escalate = sandbox.q(
                "UPDATE clusters SET status = 'pending_review' WHERE id = 'cl_1' AND status <> 'resolved' RETURNING status"
            )
            self.assertEqual(escalate.stdout.strip(), "pending_review")

            later_freeze = sandbox.q(
                "UPDATE clusters SET status = 'resolved' WHERE id = 'cl_1' AND status <> 'resolved' RETURNING status"
            )
            self.assertEqual(later_freeze.stdout.strip(), "resolved")


if __name__ == "__main__":
    unittest.main()
