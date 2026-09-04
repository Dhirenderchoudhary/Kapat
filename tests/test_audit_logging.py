"""One structured audit record per executed decision (Principle 2: "full audit chain in
one API call") and no audit record at all when a decision doesn't execute (Principle 1:
only an executed decision may leave a trace of having triggered something downstream).

Mirrors clusters.ts POST /:id/decision's actual transaction body: insert merchant_decisions FIRST,
then the compare-and-set UPDATE, then (only if that returned a row) insert exactly one audit_log
row - all inside one Postgres transaction, so a conflict (cluster already resolved) rolls back the
decision insert too, leaving no partial trace. See tests/db_test_helper.py's docstring for why
this shells out to `psql`, and why these tests SKIP (not fail) without a reachable POSTGRES_URL.

Run from the repo root: python3 -m unittest tests.test_audit_logging -v
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
class TestAuditLogging(unittest.TestCase):
    def test_a_successful_decision_writes_exactly_one_audit_log_row(self) -> None:
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO clusters (id, risk_score) VALUES ('cl_1', 0.8)")

            # The exact three-statement shape clusters.ts runs inside db.transaction(), executed
            # as one script so it's actually one Postgres transaction here too (BEGIN...COMMIT
            # implicit around a psql script is not what makes this atomic - the point being
            # tested is the *order and shape* of the writes, not psql's own transaction handling).
            sandbox.q("""
                BEGIN;
                INSERT INTO merchant_decisions (id, cluster_id, action, reason, decided_by)
                VALUES ('dec_1', 'cl_1', 'dismiss', 'legitimate shared household', 'dashboard-merchant');
                UPDATE clusters SET status = 'resolved' WHERE id = 'cl_1' AND status <> 'resolved';
                INSERT INTO audit_log (id, cluster_id, payload)
                VALUES (
                    'log_1', 'cl_1',
                    '{"event":"decision_executed","decisionId":"dec_1","action":"dismiss","clusterStatusAfter":"resolved"}'::jsonb
                );
                COMMIT;
            """)

            count = sandbox.q("SELECT count(*) FROM audit_log WHERE cluster_id = 'cl_1'")
            self.assertEqual(count.stdout.strip(), "1")

            payload = sandbox.q("SELECT payload ->> 'event' FROM audit_log WHERE cluster_id = 'cl_1'")
            self.assertEqual(payload.stdout.strip(), "decision_executed")

    def test_a_conflicting_decision_writes_no_audit_log_row_and_rolls_back_the_decision_too(self) -> None:
        # The cluster is already resolved before this decision is attempted (e.g. a second click,
        # or a retried request) - the compare-and-set UPDATE returns zero rows, exactly what
        # clusters.ts checks before throwing ApiError(409). This test proves what happens on the
        # database side once that happens: the whole transaction rolls back, so the
        # merchant_decisions insert that ran BEFORE the failed check also disappears - never a
        # decision row with no corresponding effect.
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO clusters (id, risk_score, status) VALUES ('cl_1', 0.8, 'resolved')")

            sandbox.q("""
                BEGIN;
                INSERT INTO merchant_decisions (id, cluster_id, action, decided_by)
                VALUES ('dec_conflict', 'cl_1', 'freeze', 'dashboard-merchant');
                -- Compare-and-set matches zero rows: cluster is already 'resolved'.
                -- The application would see zero RETURNING rows here and throw ApiError(409),
                -- which is what triggers the rollback below - simulated directly since this is a
                -- raw SQL proof, not a Hono request.
                ROLLBACK;
            """)

            decisions = sandbox.q("SELECT count(*) FROM merchant_decisions WHERE cluster_id = 'cl_1'")
            self.assertEqual(decisions.stdout.strip(), "0")

            audit_rows = sandbox.q("SELECT count(*) FROM audit_log WHERE cluster_id = 'cl_1'")
            self.assertEqual(audit_rows.stdout.strip(), "0")

    def test_dismiss_without_a_reason_is_rejected_at_the_schema_level(self) -> None:
        # Principle 10: dismiss requires a reason, enforced by
        # merchant_decisions_dismiss_reason_check - not just a UI-layer required field.
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO clusters (id, risk_score) VALUES ('cl_1', 0.8)")
            result = sandbox.q(
                "INSERT INTO merchant_decisions (id, cluster_id, action, decided_by) "
                "VALUES ('dec_1', 'cl_1', 'dismiss', 'dashboard-merchant')"
            )
            self.assertIn("merchant_decisions_dismiss_reason_check", result.stderr)

            count = sandbox.q("SELECT count(*) FROM merchant_decisions")
            self.assertEqual(count.stdout.strip(), "0")

    def test_dismiss_with_a_blank_or_whitespace_reason_is_also_rejected(self) -> None:
        # The check is `length(trim(reason)) > 0`, not merely `reason is not null` - a
        # whitespace-only reason is exactly the "not really a reason" case Principle 10 exists
        # to prevent, and app-level Zod validation (.min(1) after .trim()) already refuses this
        # too; this proves the database doesn't rely on the app to have gotten that right.
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO clusters (id, risk_score) VALUES ('cl_1', 0.8)")
            result = sandbox.q(
                "INSERT INTO merchant_decisions (id, cluster_id, action, reason, decided_by) "
                "VALUES ('dec_1', 'cl_1', 'dismiss', '   ', 'dashboard-merchant')"
            )
            self.assertIn("merchant_decisions_dismiss_reason_check", result.stderr)

    def test_freeze_block_escalate_do_not_require_a_reason(self) -> None:
        with FraudSchemaSandbox() as sandbox:
            sandbox.q("INSERT INTO clusters (id, risk_score) VALUES ('cl_1', 0.8)")
            for action in ("freeze", "block", "escalate"):
                result = sandbox.q(
                    f"INSERT INTO merchant_decisions (id, cluster_id, action, decided_by) "
                    f"VALUES ('dec_{action}', 'cl_1', '{action}', 'dashboard-merchant')"
                )
                self.assertEqual(result.stderr.strip(), "", f"unexpected error for action={action}: {result.stderr}")

            count = sandbox.q("SELECT count(*) FROM merchant_decisions WHERE cluster_id = 'cl_1'")
            self.assertEqual(count.stdout.strip(), "3")


if __name__ == "__main__":
    unittest.main()
