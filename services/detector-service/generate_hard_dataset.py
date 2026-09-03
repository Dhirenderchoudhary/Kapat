"""A deliberately HARD dataset, because the original one is too easy to measure anything with.

WHY THIS FILE EXISTS
====================
generate_synthetic_data.py builds fraud rings where all five signals fire at once and households
where exactly one does. Those two populations are linearly separable on a single feature, and the
consequence shows up in data/model_comparison.json: every method scores a perfect 1.000 average
precision on the held-out split, INCLUDING an isolation forest fitted with no labels at all. A
score an unlabelled model also reaches is not measuring a detector; it is measuring an exam with
the answers printed on it.

Real merchant traffic does not look like that. Real rings vary in how careful they are, and real
households share more than one thing. So this generator produces a GRADUATED population where the
two classes genuinely overlap on the five signals, and the detector has to be right about
something harder than "did more than one signal fire".

THE DIFFICULTY LADDER
=====================
Rings, from sloppy to careful:

  L0 sloppy         all five signals            (what the old generator always produced)
  L1 no address     different delivery addresses
  L2 burner cards   different addresses AND different payment methods
  L3 promo crew     coordinated timing + one funnelled promo, nothing else
  L4 careful        ONE signal only: a SIM block, or timing alone

Legitimate groups, from easy to genuinely ambiguous:

  H0 household      one shared address
  H1 family card    address + shared payment method
  H2 dinner hour    address + payment + coordinated timing
  H3 flatmates      address + payment + timing + one promo code passed around
  H4 office         a shared delivery address (the office) and nothing else in common
  H5 reseller       one payment method across many addresses: a legitimate drop-shipper

L3/L4 rings and H2/H3 households sit on top of each other in signal space. That is the point. No
weighting of those five signals can separate them, and any model that reports a perfect score on
this dataset has a bug.

WHAT MAKES IT LEARNABLE ANYWAY (AND THE ASSUMPTION THIS ENCODES)
================================================================
If the classes only overlapped, the task would be impossible rather than hard. So the generator
also gives rings the second-order structure a real ring plausibly has, none of which is one of the
five signals and all of which is computable from fields Razorpay actually returns:

  - BURST SIGNUP. Ring accounts are created for the purpose, within days of each other.
    Households accumulate over months. (`created_at` on the account.)
  - AMOUNT CLUSTERING. Ring orders sit in a narrow band just above the promo's minimum, because
    the point is to clear the threshold cheaply. Household orders vary widely. (`amount`.)
  - PROMO CONCENTRATION. A high fraction of a ring's transactions carry the promo. A household
    uses one occasionally. (`notes` / promo code.)
  - CADENCE UNIFORMITY. Ring accounts transact a similar number of times as each other. Household
    members differ a lot.

This is an ASSUMPTION, exactly like the original generator's, and it must be disclosed the same
way: a model trained here learns that belief, not fraud. What it buys is a dataset where the
answer is not already written in the five signals, so the comparison between a hand-built scorer
and a trained model finally means something. Some households deliberately share the burst-signup
pattern (a couple who joined the same week) and some rings are deliberately patient, so none of
these features is a label in disguise either.

Deterministic and stdlib-only, like the original.

Usage:
    python3 generate_hard_dataset.py [--seed 42] [--out-dir ../../data]
Writes: data/hard_train.json, data/hard_test.json, data/hard_dataset_profile.json
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_TIME = datetime(2026, 6, 1, tzinfo=timezone.utc)
SPAN_DAYS = 90

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
    ("Banjara Hills", "Hyderabad", "500034"),
    ("Alwarpet", "Chennai", "600018"),
]

# Each promo carries the minimum order value it needs, in paise. A ring sizes its orders just
# above that number; a household's basket has nothing to do with it.
PROMOS = {
    "WELCOME100": 40000,
    "FEST250": 90000,
    "SAVE20": 25000,
    "PAYDAY50": 50000,
    "FIRSTBUY": 30000,
    "MEGA300": 120000,
}
PROMO_CODES = list(PROMOS)


# ------------------------------------------------------------------ primitives


def _uid(rng: random.Random, prefix: str) -> str:
    return f"{prefix}_{uuid.UUID(int=rng.getrandbits(128))}"


def synthetic_address(rng: random.Random) -> str:
    area, city, pincode = rng.choice(CITIES)
    return f"Flat {rng.randint(101, 999)}, Block {rng.randint(1, 40)}, {area}, {city} {pincode}"


def synthetic_payment_fingerprint(rng: random.Random) -> str:
    if rng.random() < 0.5:
        return f"card:{rng.randint(400000, 499999)}-{rng.randint(1000, 9999)}"
    handle = "".join(rng.choices("abcdefghijklmnopqrstuvwxyz", k=8))
    return f"upi:{handle}@{rng.choice(['oksbi', 'okhdfcbank', 'okicici', 'okaxis', 'ybl', 'paytm'])}"


def synthetic_phone(rng: random.Random) -> str:
    return "+91" + "".join(rng.choices("0123456789", k=9))


def synthetic_phone_block(rng: random.Random, count: int) -> list[str]:
    """A consecutive run of numbers: the disposable-SIM-range pattern."""
    prefix = rng.choice("789") + "".join(rng.choices("0123456789", k=8))
    start = rng.randint(0, max(0, 9 - count))
    return [f"+91{prefix}{(start + i) % 10}" for i in range(count)]


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@dataclass
class Dataset:
    accounts: list[dict] = field(default_factory=list)
    transactions: list[dict] = field(default_factory=list)
    ground_truth_clusters: list[dict] = field(default_factory=list)


def make_account(rng: random.Random, *, address, payment_fp, phone, created_at: datetime) -> dict:
    return {
        "id": _uid(rng, "acc"),
        "customer_ref": f"cust_{uuid.UUID(int=rng.getrandbits(128)).hex[:10]}",
        "delivery_address": address,
        "payment_method_fingerprint": payment_fp,
        "phone_number": phone,
        "created_at": iso(created_at),
    }


def make_transaction(rng: random.Random, account_id: str, *, at: datetime, promo, amount_paise: int) -> dict:
    return {
        "id": _uid(rng, "txn"),
        "razorpay_event_id": _uid(rng, "evt"),
        "account_id": account_id,
        "amount_paise": amount_paise,
        "promo_code": promo,
        "created_at": iso(at),
    }


# ------------------------------------------------------------------ populations

# (label, share_address, share_payment, sim_block, coordinated, share_promo)
RING_LADDER = [
    ("L0_sloppy", True, True, True, True, True),
    ("L1_no_address", False, True, True, True, True),
    ("L2_burner_cards", False, False, True, True, True),
    ("L3_promo_crew", False, False, False, True, True),
    ("L4_careful_sim", False, False, True, False, False),
    ("L4_careful_timing", False, False, False, True, False),
]

LEGIT_LADDER = [
    ("H0_household", True, False, False, False),
    ("H1_family_card", True, True, False, False),
    ("H2_dinner_hour", True, True, True, False),
    ("H3_flatmates_coupon", True, True, True, True),
    ("H4_office", True, False, False, False),
    ("H5_reseller", False, True, False, False),
]


def _ring_amount(rng: random.Random, promo: str | None) -> int:
    """Ring orders sit just above the promo minimum: the cheapest way to clear the threshold."""
    if promo is None:
        return rng.randint(19900, 149900)
    floor = PROMOS[promo]
    return int(floor * rng.uniform(1.02, 1.18))


def _ordinary_amount(rng: random.Random) -> int:
    return rng.randint(19900, 499900)


def generate_ring(ds: Dataset, rng: random.Random, idx: int) -> None:
    level, share_addr, share_pay, sim_block, coordinated, share_promo = rng.choice(RING_LADDER)
    size = rng.randint(3, 8)

    # Burst signup: the accounts exist for this. Patient rings (20%) look like ordinary tenure,
    # so the feature cannot be read as a label.
    patient = rng.random() < 0.20
    anchor = BASE_TIME - timedelta(days=rng.randint(10, SPAN_DAYS))
    burst_days = rng.uniform(20, SPAN_DAYS) if patient else rng.uniform(0.5, 5)

    address = synthetic_address(rng)
    payment = synthetic_payment_fingerprint(rng)
    phones = synthetic_phone_block(rng, size) if sim_block else [synthetic_phone(rng) for _ in range(size)]
    promo = rng.choice(PROMO_CODES)

    ids = []
    for i in range(size):
        acc = make_account(
            rng,
            address=address if share_addr else synthetic_address(rng),
            payment_fp=payment if share_pay else synthetic_payment_fingerprint(rng),
            phone=phones[i],
            created_at=anchor - timedelta(days=rng.uniform(0, burst_days)),
        )
        ds.accounts.append(acc)
        ids.append(acc["id"])

    # Uniform cadence: every member does roughly the same amount of work.
    per_account = rng.randint(2, 4)

    if coordinated or share_promo:
        for burst in range(rng.randint(2, 4)):
            window = BASE_TIME - timedelta(days=rng.randint(2, SPAN_DAYS - 5) + burst * 3)
            spread = rng.uniform(1, 8) if coordinated else rng.uniform(240, 900)
            for aid in ids:
                at = window + timedelta(minutes=rng.uniform(0, spread))
                p = promo if share_promo else None
                ds.transactions.append(make_transaction(rng, aid, at=at, promo=p, amount_paise=_ring_amount(rng, p)))

    for aid in ids:
        for _ in range(per_account):
            at = BASE_TIME - timedelta(days=rng.randint(1, SPAN_DAYS), hours=rng.randint(0, 23))
            ds.transactions.append(make_transaction(rng, aid, at=at, promo=None, amount_paise=_ring_amount(rng, None)))

    ds.ground_truth_clusters.append(
        {"id": f"ring_{idx:04d}", "kind": "true_ring", "is_true_ring": True, "difficulty": level, "account_ids": ids}
    )


def generate_legit(ds: Dataset, rng: random.Random, idx: int) -> None:
    level, share_addr, share_pay, coordinated, share_promo = rng.choice(LEGIT_LADDER)
    size = rng.randint(2, 5) if level != "H4_office" else rng.randint(4, 9)
    if level == "H5_reseller":
        size = rng.randint(3, 6)

    # Households accumulate over months. A fifth of them joined together anyway (a couple, a
    # family that signed up on the same evening), so burst signup is evidence, not proof.
    together = rng.random() < 0.20
    anchor = BASE_TIME - timedelta(days=rng.randint(10, SPAN_DAYS))
    spread_days = rng.uniform(0.5, 5) if together else rng.uniform(25, SPAN_DAYS)

    address = synthetic_address(rng)
    payment = synthetic_payment_fingerprint(rng)
    promo = rng.choice(PROMO_CODES)

    ids = []
    for _ in range(size):
        acc = make_account(
            rng,
            address=address if share_addr else synthetic_address(rng),
            payment_fp=payment if share_pay else synthetic_payment_fingerprint(rng),
            phone=synthetic_phone(rng),
            created_at=anchor - timedelta(days=rng.uniform(0, spread_days)),
        )
        ds.accounts.append(acc)
        ids.append(acc["id"])

    if coordinated or share_promo:
        for burst in range(rng.randint(2, 4)):
            window = BASE_TIME - timedelta(days=rng.randint(2, SPAN_DAYS - 5) + burst * 3)
            spread = rng.uniform(2, 12) if coordinated else rng.uniform(240, 900)
            for aid in ids:
                at = window + timedelta(minutes=rng.uniform(0, spread))
                p = promo if share_promo else None
                ds.transactions.append(make_transaction(rng, aid, at=at, promo=p, amount_paise=_ordinary_amount(rng)))

    # Varied cadence: real people shop different amounts.
    for aid in ids:
        for _ in range(rng.randint(1, 7)):
            at = BASE_TIME - timedelta(days=rng.randint(1, SPAN_DAYS), hours=rng.randint(0, 23))
            p = rng.choice(PROMO_CODES) if rng.random() < 0.12 else None
            ds.transactions.append(make_transaction(rng, aid, at=at, promo=p, amount_paise=_ordinary_amount(rng)))

    ds.ground_truth_clusters.append(
        {
            "id": f"legit_{idx:04d}",
            "kind": "legitimate_lookalike",
            "is_true_ring": False,
            "difficulty": level,
            "account_ids": ids,
        }
    )


def generate_baseline(ds: Dataset, rng: random.Random) -> None:
    acc = make_account(
        rng,
        address=synthetic_address(rng),
        payment_fp=synthetic_payment_fingerprint(rng),
        phone=synthetic_phone(rng),
        created_at=BASE_TIME - timedelta(days=rng.uniform(1, SPAN_DAYS)),
    )
    ds.accounts.append(acc)
    for _ in range(rng.randint(1, 6)):
        at = BASE_TIME - timedelta(days=rng.randint(1, SPAN_DAYS), hours=rng.randint(0, 23))
        p = rng.choice(PROMO_CODES) if rng.random() < 0.10 else None
        ds.transactions.append(make_transaction(rng, acc["id"], at=at, promo=p, amount_paise=_ordinary_amount(rng)))


# ------------------------------------------------------------------ build


def build(seed: int, *, n_rings: int, n_legit: int, n_baseline: int) -> Dataset:
    rng = random.Random(seed)
    ds = Dataset()
    order = [("ring", i) for i in range(n_rings)] + [("legit", i) for i in range(n_legit)]
    rng.shuffle(order)
    for kind, i in order:
        (generate_ring if kind == "ring" else generate_legit)(ds, rng, i)
    for _ in range(n_baseline):
        generate_baseline(ds, rng)
    return ds


def profile(ds: Dataset) -> dict:
    by_difficulty: dict[str, int] = {}
    for c in ds.ground_truth_clusters:
        by_difficulty[c["difficulty"]] = by_difficulty.get(c["difficulty"], 0) + 1
    sizes = [len(c["account_ids"]) for c in ds.ground_truth_clusters]
    return {
        "accounts": len(ds.accounts),
        "transactions": len(ds.transactions),
        "groups": len(ds.ground_truth_clusters),
        "true_rings": sum(1 for c in ds.ground_truth_clusters if c["is_true_ring"]),
        "legitimate_groups": sum(1 for c in ds.ground_truth_clusters if not c["is_true_ring"]),
        "group_size_median": statistics.median(sizes) if sizes else 0,
        "by_difficulty": dict(sorted(by_difficulty.items())),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parents[2] / "data")
    args = ap.parse_args()

    # Separate seeds, so the test split is a different draw from the same process rather than a
    # slice of one run: no account, address or card can appear on both sides by construction.
    train = build(args.seed, n_rings=150, n_legit=210, n_baseline=900)
    test = build(args.seed + 9973, n_rings=70, n_legit=100, n_baseline=420)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, ds in (("hard_train", train), ("hard_test", test)):
        (args.out_dir / f"{name}.json").write_text(
            json.dumps(
                {
                    "accounts": ds.accounts,
                    "transactions": ds.transactions,
                    "ground_truth_clusters": ds.ground_truth_clusters,
                },
                indent=1,
            )
            + "\n",
            encoding="utf-8",
        )

    prof = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "why": (
            "The original split is separable on a single feature: rings fire all five signals, "
            "households fire one. Every model scores 1.000 on it, including one trained with no "
            "labels. This split grades both classes so they overlap in signal space, and gives "
            "rings second-order structure (burst signup, amounts near the promo floor, promo "
            "concentration, uniform cadence) that a model can learn and the five-signal heuristic "
            "does not use."
        ),
        "ladder": {
            "rings": [r[0] for r in RING_LADDER],
            "legitimate": [h[0] for h in LEGIT_LADDER],
        },
        "train": profile(train),
        "test": profile(test),
    }
    (args.out_dir / "hard_dataset_profile.json").write_text(json.dumps(prof, indent=2) + "\n", encoding="utf-8")

    for split in ("train", "test"):
        p = prof[split]
        print(f"{split:5} {p['accounts']:>5} accounts  {p['transactions']:>6} txns  "
              f"{p['true_rings']:>3} rings  {p['legitimate_groups']:>3} legit groups")
    print("\nDifficulty mix (train):")
    for k, v in prof["train"]["by_difficulty"].items():
        print(f"  {k:22} {v}")
    print(f"\nWrote {args.out_dir}/hard_train.json, hard_test.json, hard_dataset_profile.json")


if __name__ == "__main__":
    main()
