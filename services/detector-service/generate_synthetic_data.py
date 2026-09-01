"""Phase 1 (Phases.md): synthetic data generator for the fraud-ring detector.

Produces accounts, transactions, and account_links (Architecture.md §5) with two deliberately
different populations mixed together, plus a baseline of unconnected accounts:

  - TRUE RINGS: accounts sharing address + payment method + a sequential/disposable phone
    pattern, transacting within a tight coordinated window, reusing the same promo code
    (Architecture.md §2.1's five signal types, all present at once - this is what makes a ring
    a ring rather than a coincidence).
  - LEGITIMATE LOOK-ALIKES: accounts sharing only a delivery address (a real household or
    roommates), with independent payment methods, independent phone numbers, uncoordinated
    transaction timing, and no promo-code reuse. These exist specifically so precision/recall
    (PRD.md §9) is not measured against an easy dataset - Phases.md Phase 1 exit criteria is
    explicit that a dataset where every connected account is a ring is worthless.
  - BASELINE: ordinary accounts with no shared signals with anyone, the majority of the data.

Every account_links row this script writes carries a labeled signal_type and confidence
(Rules.md Principle 9) and matches the check constraint on packages/db/src/schema/fraud.ts's
account_links table. ground_truth_clusters records which account groups are real rings vs.
look-alikes, for evaluate.py (Phase 3) to score against - the generator is the only place this
ground truth exists, so evaluate.py must never guess it from account_links alone.

Deterministic and dependency-free (stdlib only) on purpose: `python3 generate_synthetic_data.py`
must run the same way on any machine, with no pip install required to reproduce the committed
train/test split (Phases.md Phase 1 deliverable: "Fixed, committed train/test split").

Usage:
    python3 generate_synthetic_data.py [--seed 42] [--out-dir ../../data]

All data is synthetic (Rules.md Principle 6) - no real accounts, addresses, phone numbers, or
transactions anywhere in this file's output.
"""

from __future__ import annotations

import argparse
import json
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

SIGNAL_TYPES = (
    "shared_address",
    "shared_payment",
    "shared_phone_pattern",
    "coordinated_timing",
    "shared_promo",
)

# Generic, clearly-synthetic city/area names - not real addresses of real people.
CITIES = [
    ("Koramangala", "Bengaluru", "560034"),
    ("Andheri East", "Mumbai", "400069"),
    ("Salt Lake", "Kolkata", "700064"),
    ("Hitech City", "Hyderabad", "500081"),
    ("Indiranagar", "Bengaluru", "560038"),
    ("Powai", "Mumbai", "400076"),
    ("Sector 62", "Noida", "201309"),
    ("Anna Nagar", "Chennai", "600040"),
    ("Kothrud", "Pune", "411038"),
    ("Vastrapur", "Ahmedabad", "380015"),
]

PROMO_CODES = ["WELCOME100", "FEST250", "SAVE20", "PAYDAY50", "FIRSTBUY", "MEGA300"]

BASE_TIME = datetime(2026, 6, 1, tzinfo=timezone.utc)
SPAN_DAYS = 60


def synthetic_address(rng: random.Random) -> str:
    area, city, pincode = rng.choice(CITIES)
    block = rng.randint(1, 40)
    flat = rng.randint(101, 999)
    return f"Flat {flat}, Block {block}, {area}, {city} {pincode}"


def synthetic_card_fingerprint(rng: random.Random) -> str:
    bin_ = rng.randint(400000, 499999)
    last4 = rng.randint(1000, 9999)
    return f"card:{bin_}-{last4}"


def synthetic_upi_fingerprint(rng: random.Random) -> str:
    handle = "".join(rng.choices("abcdefghijklmnopqrstuvwxyz", k=8))
    bank = rng.choice(["oksbi", "okhdfcbank", "okicici", "okaxis", "ybl", "paytm"])
    return f"upi:{handle}@{bank}"


def synthetic_payment_fingerprint(rng: random.Random) -> str:
    return synthetic_card_fingerprint(rng) if rng.random() < 0.5 else synthetic_upi_fingerprint(rng)


def synthetic_phone_block(rng: random.Random, count: int) -> list[str]:
    """A sequential run of numbers - the disposable-number-range pattern (Architecture.md §2.1)."""
    prefix = rng.choice(["7", "8", "9"]) + "".join(rng.choices("0123456789", k=8))
    start = rng.randint(0, 9 - count) if count <= 9 else 0
    return [f"+91{prefix}{(start + i) % 10}" for i in range(count)]


def synthetic_phone(rng: random.Random) -> str:
    return "+91" + "".join(rng.choices("0123456789", k=9))


def event_id(rng: random.Random) -> str:
    return f"evt_{uuid.UUID(int=rng.getrandbits(128))}"


def account_id(rng: random.Random) -> str:
    return f"acc_{uuid.UUID(int=rng.getrandbits(128))}"


def link_id(rng: random.Random) -> str:
    return f"lnk_{uuid.UUID(int=rng.getrandbits(128))}"


def txn_id(rng: random.Random) -> str:
    return f"txn_{uuid.UUID(int=rng.getrandbits(128))}"


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@dataclass
class Dataset:
    accounts: list[dict] = field(default_factory=list)
    transactions: list[dict] = field(default_factory=list)
    account_links: list[dict] = field(default_factory=list)
    ground_truth_clusters: list[dict] = field(default_factory=list)


def make_account(rng: random.Random, *, address: str | None, payment_fp: str | None, phone: str) -> dict:
    return {
        "id": account_id(rng),
        "customer_ref": f"cust_{uuid.UUID(int=rng.getrandbits(128)).hex[:10]}",
        "delivery_address": address,
        "payment_method_fingerprint": payment_fp,
        "phone_number": phone,
        "created_at": iso(BASE_TIME - timedelta(days=rng.randint(1, SPAN_DAYS))),
    }


def make_transaction(
    rng: random.Random, account_id_: str, *, at: datetime, promo_code: str | None, amount_paise: int | None = None
) -> dict:
    return {
        "id": txn_id(rng),
        "razorpay_event_id": event_id(rng),
        "account_id": account_id_,
        "amount_paise": amount_paise if amount_paise is not None else rng.randint(19900, 499900),
        "promo_code": promo_code,
        "created_at": iso(at),
    }


def add_link(ds: Dataset, rng: random.Random, a: str, b: str, signal_type: str, confidence: float) -> None:
    lo, hi = sorted([a, b])
    ds.account_links.append(
        {
            "id": link_id(rng),
            "account_a": lo,
            "account_b": hi,
            "signal_type": signal_type,
            "confidence": round(confidence, 2),
        }
    )


def generate_true_ring(ds: Dataset, rng: random.Random, ring_index: int, size: int | None = None) -> list[str]:
    """A coordinated fraud ring: every signal type fires, tightly, on purpose.

    size overrides the random 3-6 range - used by tests/test_clustering.py etc. to build an
    exact, reproducible fixture without duplicating this generation logic. Passing None (the
    Phase 1 default) leaves the original random.randint(3, 6) call in place, so the committed
    data/detector_train.json and data/detector_test.json are unaffected by this addition.
    """
    size = size if size is not None else rng.randint(3, 6)
    address = synthetic_address(rng)
    payment_fp = synthetic_payment_fingerprint(rng)
    phones = synthetic_phone_block(rng, size)
    promo = rng.choice(PROMO_CODES)

    ids = []
    for i in range(size):
        acc = make_account(rng, address=address, payment_fp=payment_fp, phone=phones[i])
        ds.accounts.append(acc)
        ids.append(acc["id"])

    # Coordinated timing: every account transacts within a tight window (minutes, not days).
    window_start = BASE_TIME - timedelta(days=rng.randint(1, SPAN_DAYS - 1))
    for aid in ids:
        offset_minutes = rng.uniform(0, 6)
        at = window_start + timedelta(minutes=offset_minutes)
        ds.transactions.append(make_transaction(rng, aid, at=at, promo_code=promo))
        # A second, ordinary transaction outside the promo window, still same account.
        later = window_start + timedelta(days=rng.randint(2, 10))
        ds.transactions.append(make_transaction(rng, aid, at=later, promo_code=None))

    for i in range(size):
        for j in range(i + 1, size):
            a, b = ids[i], ids[j]
            add_link(ds, rng, a, b, "shared_address", 0.95)
            add_link(ds, rng, a, b, "shared_payment", 0.9)
            add_link(ds, rng, a, b, "shared_phone_pattern", 0.75)
            add_link(ds, rng, a, b, "coordinated_timing", rng.uniform(0.75, 0.95))
            add_link(ds, rng, a, b, "shared_promo", 0.85)

    ds.ground_truth_clusters.append(
        {
            "id": f"ring_{ring_index:03d}",
            "kind": "true_ring",
            "is_true_ring": True,
            "account_ids": ids,
        }
    )
    return ids


def generate_legitimate_lookalike(ds: Dataset, rng: random.Random, group_index: int, size: int | None = None) -> list[str]:
    """A real household/roommates: one shared signal (address), nothing else lines up.

    size overrides the random 2-3 range - see generate_true_ring's docstring; None preserves
    Phase 1's original behavior exactly.
    """
    size = size if size is not None else rng.randint(2, 3)
    address = synthetic_address(rng)

    ids = []
    for _ in range(size):
        acc = make_account(
            rng,
            address=address,
            payment_fp=synthetic_payment_fingerprint(rng),  # independent per person
            phone=synthetic_phone(rng),  # independent, not a sequential block
        )
        ds.accounts.append(acc)
        ids.append(acc["id"])

    # Ordinary, uncoordinated shopping over weeks - no shared promo, no tight window.
    for aid in ids:
        for _ in range(rng.randint(1, 3)):
            at = BASE_TIME - timedelta(days=rng.randint(1, SPAN_DAYS), hours=rng.randint(0, 23))
            promo = rng.choice(PROMO_CODES) if rng.random() < 0.15 else None
            ds.transactions.append(make_transaction(rng, aid, at=at, promo_code=promo))

    for i in range(size):
        for j in range(i + 1, size):
            add_link(ds, rng, ids[i], ids[j], "shared_address", 0.9)

    ds.ground_truth_clusters.append(
        {
            "id": f"lookalike_{group_index:03d}",
            "kind": "legitimate_lookalike",
            "is_true_ring": False,
            "account_ids": ids,
        }
    )
    return ids


def generate_baseline_account(ds: Dataset, rng: random.Random) -> str:
    """An ordinary account, unconnected to anyone - the majority of real traffic."""
    acc = make_account(
        rng,
        address=synthetic_address(rng),
        payment_fp=synthetic_payment_fingerprint(rng),
        phone=synthetic_phone(rng),
    )
    ds.accounts.append(acc)
    for _ in range(rng.randint(1, 4)):
        at = BASE_TIME - timedelta(days=rng.randint(1, SPAN_DAYS), hours=rng.randint(0, 23))
        promo = rng.choice(PROMO_CODES) if rng.random() < 0.1 else None
        ds.transactions.append(make_transaction(rng, acc["id"], at=at, promo_code=promo))
    return acc["id"]


def build_dataset(seed: int, *, n_rings: int, n_lookalikes: int, n_baseline: int) -> Dataset:
    rng = random.Random(seed)
    ds = Dataset()
    for i in range(n_rings):
        generate_true_ring(ds, rng, i)
    for i in range(n_lookalikes):
        generate_legitimate_lookalike(ds, rng, i)
    for _ in range(n_baseline):
        generate_baseline_account(ds, rng)
    return ds


def split_dataset(ds: Dataset, *, seed: int, test_fraction: float) -> tuple[Dataset, Dataset]:
    """Splits at the cluster level (a ring or look-alike stays whole in one side), so the held-out
    set contains complete, evaluable clusters of both kinds - never a partial ring."""
    rng = random.Random(seed + 1)

    rings = [c for c in ds.ground_truth_clusters if c["kind"] == "true_ring"]
    lookalikes = [c for c in ds.ground_truth_clusters if c["kind"] == "legitimate_lookalike"]
    rng.shuffle(rings)
    rng.shuffle(lookalikes)

    def split_list(items: list) -> tuple[list, list]:
        n_test = max(1, round(len(items) * test_fraction)) if items else 0
        return items[n_test:], items[:n_test]

    train_rings, test_rings = split_list(rings)
    train_lookalikes, test_lookalikes = split_list(lookalikes)

    baseline_ids = [
        a["id"]
        for a in ds.accounts
        if not any(a["id"] in c["account_ids"] for c in ds.ground_truth_clusters)
    ]
    rng.shuffle(baseline_ids)
    n_baseline_test = round(len(baseline_ids) * test_fraction)
    test_baseline_ids = set(baseline_ids[:n_baseline_test])

    def partition(clusters: list[dict]) -> tuple[set[str], list[dict]]:
        ids: set[str] = set()
        for c in clusters:
            ids.update(c["account_ids"])
        return ids, clusters

    train_cluster_ids, train_clusters = partition(train_rings + train_lookalikes)
    test_cluster_ids, test_clusters = partition(test_rings + test_lookalikes)

    train_account_ids = train_cluster_ids | (set(baseline_ids) - test_baseline_ids)
    test_account_ids = test_cluster_ids | test_baseline_ids

    def subset(account_ids: set[str], clusters: list[dict]) -> Dataset:
        out = Dataset()
        out.accounts = [a for a in ds.accounts if a["id"] in account_ids]
        out.transactions = [t for t in ds.transactions if t["account_id"] in account_ids]
        out.account_links = [
            link for link in ds.account_links if link["account_a"] in account_ids and link["account_b"] in account_ids
        ]
        out.ground_truth_clusters = clusters
        return out

    return subset(train_account_ids, train_clusters), subset(test_account_ids, test_clusters)


def write_dataset(ds: Dataset, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "accounts": ds.accounts,
        "transactions": ds.transactions,
        "account_links": ds.account_links,
        "ground_truth_clusters": ds.ground_truth_clusters,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")


def summarize(name: str, ds: Dataset) -> None:
    n_rings = sum(1 for c in ds.ground_truth_clusters if c["kind"] == "true_ring")
    n_lookalikes = sum(1 for c in ds.ground_truth_clusters if c["kind"] == "legitimate_lookalike")
    clustered_ids = {aid for c in ds.ground_truth_clusters for aid in c["account_ids"]}
    n_baseline = len(ds.accounts) - len(clustered_ids)
    print(
        f"{name}: {len(ds.accounts)} accounts, {len(ds.transactions)} transactions, "
        f"{len(ds.account_links)} account_links | "
        f"{n_rings} true rings, {n_lookalikes} legitimate look-alikes, {n_baseline} baseline accounts"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=42, help="Fixed seed - keeps the committed split reproducible.")
    parser.add_argument("--n-rings", type=int, default=18, help="Number of true fraud rings to embed.")
    parser.add_argument("--n-lookalikes", type=int, default=22, help="Number of legitimate look-alike groups.")
    parser.add_argument("--n-baseline", type=int, default=260, help="Number of unconnected baseline accounts.")
    parser.add_argument("--test-fraction", type=float, default=0.3, help="Fraction of clusters held out for test.")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="Output directory. Defaults to <repo-root>/data (two levels up from this script).",
    )
    args = parser.parse_args()

    out_dir = args.out_dir or (Path(__file__).resolve().parent.parent.parent / "data")

    ds = build_dataset(args.seed, n_rings=args.n_rings, n_lookalikes=args.n_lookalikes, n_baseline=args.n_baseline)
    train, test = split_dataset(ds, seed=args.seed, test_fraction=args.test_fraction)

    write_dataset(train, out_dir / "detector_train.json")
    write_dataset(test, out_dir / "detector_test.json")

    summarize("full", ds)
    summarize("train", train)
    summarize("test (held-out)", test)
    print(f"\nWrote {out_dir / 'detector_train.json'} and {out_dir / 'detector_test.json'}")


if __name__ == "__main__":
    main()
