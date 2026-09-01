"""Lightweight per-transaction risk score (Architecture.md §2.1, PRD.md §2).

Phase 4 (Phases.md). Explicitly a simple rules-based stand-in for what a real deployment would
get from Razorpay's own Thirdwatch - not a novel contribution, and this module, the README, and
the demo must keep saying so (Rules.md Principle 5, PRD.md §2). This is a per-transaction signal
that feeds into a cluster's evidence (via cluster_scorer.py) as one more input - not a standalone
deliverable, and not a claim to have rebuilt Thirdwatch.

score_transaction(transaction, account, account_transactions) -> dict combines three rules-based
features into a single risk_score in [0, 1]:

  - amount_score: this transaction's amount vs. the account's own average (excluding itself).
    Needs at least MIN_HISTORY_FOR_AMOUNT_ANOMALY prior transactions to mean anything - with
    fewer, there is no real baseline to be anomalous against, so this scores 0 and says so in
    "amount_basis" rather than inventing a number from an empty history (Rules.md Principle 5).
  - velocity_score: how many of the account's *other* transactions land within
    VELOCITY_WINDOW of this one - a burst of near-simultaneous transactions is a real,
    well-known fraud/card-testing pattern.
  - newness_score: how soon after account creation this transaction happened. A transaction
    minutes after signup is inherently riskier than one from a months-old account, decaying to 0
    over NEW_ACCOUNT_DECAY_HOURS.

risk_score = WEIGHT_AMOUNT*amount_score + WEIGHT_VELOCITY*velocity_score + WEIGHT_NEWNESS*newness_score

Fixed weights, a judgment call (Rules.md Principle 5) - not fitted against any labeled fraud
outcome, because this dataset has none. `"scoring_method": "heuristic"` on the return value says
so plainly, matching cluster_scorer.py's own convention.
"""

from __future__ import annotations

from datetime import datetime, timedelta

# Judgment calls (Rules.md Principle 5), not fitted parameters.
MIN_HISTORY_FOR_AMOUNT_ANOMALY = 2
AMOUNT_ANOMALY_REFERENCE_RATIO = 5.0  # amount >= 5x the account's own average -> amount_score saturates at 1.0
VELOCITY_WINDOW = timedelta(minutes=10)
VELOCITY_REFERENCE = 3  # 3+ other transactions inside the window -> velocity_score saturates at 1.0
NEW_ACCOUNT_DECAY_HOURS = 24 * 30  # newness_score decays to 0 by 30 days old

WEIGHT_AMOUNT = 0.20
WEIGHT_VELOCITY = 0.35
WEIGHT_NEWNESS = 0.45


def _parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _clamp01(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def _amount_score(transaction: dict, other_transactions: list[dict]) -> tuple[float, str]:
    if len(other_transactions) < MIN_HISTORY_FOR_AMOUNT_ANOMALY:
        return 0.0, "insufficient history to assess (fewer than 2 prior transactions on this account)"
    mean_other = sum(t["amount_paise"] for t in other_transactions) / len(other_transactions)
    if mean_other <= 0:
        return 0.0, "insufficient history to assess (no positive prior amounts)"
    ratio = transaction["amount_paise"] / mean_other
    score = _clamp01((ratio - 1.0) / (AMOUNT_ANOMALY_REFERENCE_RATIO - 1.0))
    return score, f"{ratio:.2f}x this account's own average transaction amount"


def _velocity_score(transaction: dict, other_transactions: list[dict]) -> tuple[float, int]:
    txn_dt = _parse_dt(transaction["created_at"])
    nearby = sum(
        1 for t in other_transactions if abs(_parse_dt(t["created_at"]) - txn_dt) <= VELOCITY_WINDOW
    )
    return _clamp01(nearby / VELOCITY_REFERENCE), nearby


def _newness_score(transaction: dict, account: dict) -> tuple[float, float]:
    txn_dt = _parse_dt(transaction["created_at"])
    created_dt = _parse_dt(account["created_at"])
    age_hours = (txn_dt - created_dt).total_seconds() / 3600.0
    if age_hours < 0:
        # Transaction timestamped before the account's own creation - not meaningful; treat as
        # no signal rather than guessing.
        return 0.0, age_hours
    return _clamp01(1.0 - (age_hours / NEW_ACCOUNT_DECAY_HOURS)), age_hours


def score_transaction(transaction: dict, account: dict, account_transactions: list[dict]) -> dict:
    other_transactions = [t for t in account_transactions if t["id"] != transaction["id"]]

    amount_score, amount_basis = _amount_score(transaction, other_transactions)
    velocity_score, nearby_count = _velocity_score(transaction, other_transactions)
    newness_score, age_hours = _newness_score(transaction, account)

    risk_score = (
        WEIGHT_AMOUNT * amount_score + WEIGHT_VELOCITY * velocity_score + WEIGHT_NEWNESS * newness_score
    )
    risk_score = round(_clamp01(risk_score), 4)

    return {
        "transaction_id": transaction["id"],
        "risk_score": risk_score,
        "features": {
            "amount_score": round(amount_score, 4),
            "amount_basis": amount_basis,
            "velocity_score": round(velocity_score, 4),
            "nearby_transaction_count": nearby_count,
            "newness_score": round(newness_score, 4),
            "account_age_at_transaction_hours": round(age_hours, 2),
        },
        "scoring_method": "heuristic",
        "scoring_note": (
            "risk_score is a hand-built weighted combination of amount/velocity/newness "
            "(Thirdwatch stand-in, not a trained model) - see transaction_risk.py docstring."
        ),
    }


def score_account_transactions(account: dict, transactions: list[dict]) -> dict[str, dict]:
    """Convenience batch wrapper: scores every transaction belonging to one account against its
    own history. Returns {transaction_id: score_transaction(...) result}."""
    return {t["id"]: score_transaction(t, account, transactions) for t in transactions}
