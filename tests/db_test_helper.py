"""Shared helper for tests/test_idempotency.py and tests/test_audit_logging.py.

Not a test module itself (no test_ prefix - unittest's discovery won't try to collect it).

These two tests exercise real guarantees of the fraud-ring schema (packages/db/drizzle/
0004_fraud_ring_platform.sql, 0005_account_idempotency.sql) and of the exact SQL patterns
api/hono/src/routers/webhooks.ts and clusters.ts run - compare-and-set updates, ON CONFLICT DO
NOTHING, and CHECK constraints. There is no Python Postgres driver installed in this repo's
Python environment (no psycopg2/asyncpg: no network access to pip
install one), so this shells out to the `psql` CLI directly rather than skip the guarantee
entirely or fake it with an in-memory stand-in that wouldn't actually prove anything about
Postgres's own constraint enforcement.

Connects using the same POSTGRES_URL environment variable the real app reads
(packages/env/src/db.ts) - unset in most sandboxes, which is why both test modules SKIP (not
fail) when either `psql` isn't on PATH or POSTGRES_URL isn't set or unreachable. A skip with a
clear reason is Principle 5's "honest placeholder": these tests ran and passed against a
real local Postgres 16 instance during Phase 8 development; they are
written to run for real again wherever `docker-compose.yml`'s postgres service (or any reachable
POSTGRES_URL) is available - most importantly, in CI or a real `bun run dev` environment - not to
merely exist unexecuted.

Each test gets its own uniquely-named Postgres SCHEMA (not the app's public schema, and not a
throwaway database) so it never touches real data and can run alongside the actual app: the
schema is created fresh with exactly the tables/constraints these tests need (copied verbatim
from 0004/0005's DDL, not re-derived), exercised, and dropped (CASCADE) in a `finally` block
whether the test passed or raised.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid

POSTGRES_URL = os.environ.get("POSTGRES_URL")


def psql_available() -> bool:
    return shutil.which("psql") is not None


def postgres_reachable() -> bool:
    if not psql_available() or not POSTGRES_URL:
        return False
    result = subprocess.run(
        ["psql", POSTGRES_URL, "-c", "SELECT 1", "-qtA"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    return result.returncode == 0


SKIP_REASON = (
    "psql not on PATH, POSTGRES_URL not set, or Postgres unreachable - these tests need a real "
    "Postgres to exercise DB-level constraints (compare-and-set, ON CONFLICT, CHECK). See "
    "tests/db_test_helper.py's docstring."
)


def run_sql(sql: str) -> subprocess.CompletedProcess:
    """Runs `sql` against POSTGRES_URL, tuples-only, unaligned, '|'-delimited output - the same
    shape used throughout this session's manual SQL-level verification.
    Does not pass -v ON_ERROR_STOP=1: some of these tests deliberately expect a statement to
    raise (a bare CHECK/UNIQUE constraint violation with no app-level ON CONFLICT handling), and
    need the process to keep running so later statements in the same script can assert on that.
    """
    return subprocess.run(
        ["psql", POSTGRES_URL, "-qtA", "-c", sql],
        capture_output=True,
        text=True,
        timeout=10,
    )


def run_sql_script(sql: str) -> subprocess.CompletedProcess:
    """Like run_sql, but for multi-statement scripts piped via stdin (heredoc-style), matching
    exactly how this session's manual verification ran its multi-step proofs."""
    return subprocess.run(
        ["psql", POSTGRES_URL, "-qtA"],
        input=sql,
        capture_output=True,
        text=True,
        timeout=10,
    )


class FraudSchemaSandbox:
    """Context manager: creates a uniquely-named schema with the fraud-ring tables (verbatim from
    0004_fraud_ring_platform.sql + 0005_account_idempotency.sql), yields the schema name, drops it
    (CASCADE) on exit - success or failure - so a crashed test never leaves scratch tables behind.
    """

    def __enter__(self) -> "FraudSchemaSandbox":
        self.schema = f"test_idempotency_{uuid.uuid4().hex[:12]}"
        script = f"""
        CREATE SCHEMA "{self.schema}";
        SET search_path TO "{self.schema}";

        CREATE TABLE accounts (
            id text PRIMARY KEY NOT NULL,
            customer_ref text NOT NULL,
            delivery_address text,
            payment_method_fingerprint text,
            phone_number text,
            created_at timestamp DEFAULT now() NOT NULL
        );
        CREATE UNIQUE INDEX accounts_customer_ref_uidx ON accounts USING btree (customer_ref);

        CREATE TABLE transactions (
            id text PRIMARY KEY NOT NULL,
            razorpay_event_id text NOT NULL,
            account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            amount_paise bigint NOT NULL,
            promo_code text,
            created_at timestamp DEFAULT now() NOT NULL,
            CONSTRAINT transactions_razorpay_event_id_unique UNIQUE (razorpay_event_id)
        );

        CREATE TABLE clusters (
            id text PRIMARY KEY NOT NULL,
            risk_score real NOT NULL,
            status text DEFAULT 'pending_review' NOT NULL,
            chargeback_exposure_paise bigint,
            created_at timestamp DEFAULT now() NOT NULL,
            CONSTRAINT clusters_status_check CHECK (status in ('pending_review', 'pending_verification', 'resolved')),
            CONSTRAINT clusters_risk_score_check CHECK (risk_score >= 0 and risk_score <= 1)
        );

        CREATE TABLE merchant_decisions (
            id text PRIMARY KEY NOT NULL,
            cluster_id text NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
            action text NOT NULL,
            reason text,
            decided_by text NOT NULL,
            decided_at timestamp DEFAULT now() NOT NULL,
            CONSTRAINT merchant_decisions_action_check CHECK (action in ('freeze', 'block', 'escalate', 'dismiss')),
            CONSTRAINT merchant_decisions_dismiss_reason_check
                CHECK (action <> 'dismiss' or (reason is not null and length(trim(reason)) > 0))
        );

        CREATE TABLE audit_log (
            id text PRIMARY KEY NOT NULL,
            cluster_id text NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
            payload jsonb NOT NULL,
            created_at timestamp DEFAULT now() NOT NULL
        );
        """
        result = run_sql_script(script)
        if result.returncode != 0:
            raise RuntimeError(f"Failed to set up sandbox schema: {result.stderr}")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        run_sql(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE')

    def q(self, sql: str) -> subprocess.CompletedProcess:
        """Runs `sql` with search_path pinned to this sandbox's schema."""
        return run_sql_script(f'SET search_path TO "{self.schema}"; {sql}')
