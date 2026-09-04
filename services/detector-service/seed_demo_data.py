"""Seeds Postgres with the real Phase 1 synthetic dataset - the same 396 accounts / 949
transactions run_batch.py exercises (train + test combined) - so there's something for the actual
detector agent to detect.

This script deliberately does NOT compute clusters itself. It only inserts raw accounts and
transactions - exactly what webhooks.ts would insert from real Razorpay events, one at a time, if
this many events actually arrived. Turning that raw data into clusters/account_links/
cluster_members rows is the live detector agent's job now: after this script finishes, call

    POST /api/clusters/detect

on the running api service (see api/hono/src/routers/clusters.ts) - that route calls the actual
running services/detector-service container over HTTP (Architecture.md §6's documented contract:
"(internal) POST services/detector-service /detect-rings"), gets back real clusters with real
evidence, and persists them. That is the one place graph_builder -> clustering -> cluster_scorer's
real output becomes rows in Postgres - not this script, and not a local reimplementation of the
pipeline (an earlier version of this script called that pipeline
directly in Python, which worked but bypassed the actual live agent entirely - this version
doesn't, so what ends up on the dashboard is genuinely what the running agent detected).

One consequence worth knowing: this script now has zero non-stdlib dependencies (no networkx) -
detection runs inside the detector-service container instead, which already has networkx from its
own requirements.txt / Dockerfile.

Idempotent by construction: account/transaction ids come straight from the committed dataset
files (already unique) and every insert uses ON CONFLICT DO NOTHING - safe to re-run.

Usage (POSTGRES_URL must point at a reachable Postgres - e.g. `docker compose up`'s postgres
service on postgres://razorpay:razorpay@localhost:5433/razorpay):
    POSTGRES_URL=postgres://razorpay:razorpay@localhost:5433/razorpay \
        python3 services/detector-service/seed_demo_data.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
POSTGRES_URL = os.environ.get("POSTGRES_URL")


def load_combined_dataset() -> dict:
    """Same shape/logic as run_batch.py's load_combined_dataset() -
    reimplemented here, not imported, specifically so this script stays free of run_batch.py's
    module-level `import cluster_scorer` / `clustering` / `graph_builder` chain, which pulls in
    networkx - a dependency this script has no other reason to need."""
    train = json.loads((DATA_DIR / "detector_train.json").read_text(encoding="utf-8"))
    test = json.loads((DATA_DIR / "detector_test.json").read_text(encoding="utf-8"))

    train_ids = {a["id"] for a in train["accounts"]}
    test_ids = {a["id"] for a in test["accounts"]}
    overlap = train_ids & test_ids
    if overlap:
        raise ValueError(f"train/test account id overlap found ({len(overlap)} ids) - refusing to merge")

    return {
        "accounts": train["accounts"] + test["accounts"],
        "transactions": train["transactions"] + test["transactions"],
    }


def sql_str(value: str | None) -> str:
    if value is None:
        return "NULL"
    return "'" + value.replace("'", "''") + "'"


def sql_num(value: float | int | None) -> str:
    return "NULL" if value is None else str(value)


def chunked(items: list, size: int = 500):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def build_statements() -> tuple[list[str], dict]:
    data = load_combined_dataset()
    accounts, transactions = data["accounts"], data["transactions"]

    statements: list[str] = ["BEGIN;"]

    for batch in chunked(accounts):
        rows = ", ".join(
            f"({sql_str(a['id'])}, {sql_str(a['customer_ref'])}, {sql_str(a.get('delivery_address'))}, "
            f"{sql_str(a.get('payment_method_fingerprint'))}, {sql_str(a.get('phone_number'))}, {sql_str(a.get('created_at'))})"
            for a in batch
        )
        statements.append(
            "INSERT INTO accounts (id, customer_ref, delivery_address, payment_method_fingerprint, phone_number, created_at) "
            f"VALUES {rows} ON CONFLICT (id) DO NOTHING;"
        )

    for batch in chunked(transactions):
        rows = ", ".join(
            f"({sql_str(t['id'])}, {sql_str(t['razorpay_event_id'])}, {sql_str(t['account_id'])}, "
            f"{sql_num(t['amount_paise'])}, {sql_str(t.get('promo_code'))}, {sql_str(t.get('created_at'))})"
            for t in batch
        )
        statements.append(
            "INSERT INTO transactions (id, razorpay_event_id, account_id, amount_paise, promo_code, created_at) "
            f"VALUES {rows} ON CONFLICT (id) DO NOTHING;"
        )

    statements.append("COMMIT;")

    summary = {"accounts": len(accounts), "transactions": len(transactions)}
    return statements, summary


def main() -> None:
    if shutil.which("psql") is None:
        print("psql not found on PATH - install the Postgres client, or run this from a container/host that has it.", file=sys.stderr)
        sys.exit(1)
    if not POSTGRES_URL:
        print("POSTGRES_URL is not set - point it at the same Postgres your api service uses, e.g.:\n"
              "  POSTGRES_URL=postgres://razorpay:razorpay@localhost:5433/razorpay python3 services/detector-service/seed_demo_data.py", file=sys.stderr)
        sys.exit(1)

    statements, summary = build_statements()

    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write("\n".join(statements))
        sql_path = f.name

    try:
        result = subprocess.run(["psql", POSTGRES_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", sql_path], capture_output=True, text=True)
    finally:
        os.unlink(sql_path)

    if result.returncode != 0:
        print("Seeding failed - the transaction was rolled back, nothing partial was written.", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    print("Seeded raw accounts/transactions into Postgres (idempotent - safe to re-run):")
    for key, value in summary.items():
        print(f"  {key}: {value}")
    print(
        "\nNo clusters yet - that's the detector agent's job now, not this script's. Trigger it "
        "with:\n"
        "  curl -X POST http://localhost:4000/api/clusters/detect -H 'content-type: application/json' -d '{}'\n"
        "That calls the real, running detector-service container and persists what it actually finds."
    )


if __name__ == "__main__":
    main()
