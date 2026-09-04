"""Serves the trained ring classifier inside the live detector.

WHAT THIS FILE IS FOR
=====================
train_model.py showed that a trained model beats the hand-built scorer on realistic data: 94.7%
precision at 100% recall against 67.4% / 86.1%, and 2 costly errors against 35. That result was
worth nothing to a merchant while it lived only in a JSON report, because the running agent still
scored every payment with the rule alone. This module is what closes that gap.

THREE RULES IT FOLLOWS, EACH LEARNED THE HARD WAY
=================================================

1. IT DEGRADES, IT NEVER BREAKS. scikit-learn, joblib, and the model file are all optional. If any
   is missing - a slim container, a fresh clone, a failed training run - `score()` returns None and
   the caller falls back to the heuristic. A fraud detector that refuses to run because an
   optional dependency is absent is worse than one that runs slightly less well, and the
   /detect-rings contract must not change shape depending on what is installed.

2. IT VERIFIES THE FEATURE CONTRACT BEFORE TRUSTING THE MODEL. The model card records the exact
   feature names, in order, that the estimator was fitted on. If features.py has since changed,
   the vector this process builds no longer means what the model thinks it means - and the failure
   is silent, because a forest will happily return a confident 0.91 for a scrambled input. So a
   mismatch disables the model rather than producing plausible nonsense.

3. IT NEVER REPLACES THE EXPLANATION. The heuristic's plain-language reasons ride along with every
   model score, and the model's own top contributing features are reported next to them. A merchant
   about to hold a customer's money is owed a reason, and "the ensemble said 0.91" is not one. This
   is also why the two verdicts are reported separately rather than blended: when the rule and the
   model disagree, that disagreement is information, and hiding it inside one averaged number would
   throw away the most interesting thing on the screen.

Usage is deliberately narrow: `score(...)` and `model_info()`. Everything else is private.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import features as F

# Same escape hatch as the API's METRICS_DATA_DIR, and for the same reason: the depth from this
# file to the repo's data/ directory differs between running from source (parents[2] is the repo
# root) and running in the container (WORKDIR is /app/services/detector-service, so parents[2] is
# /app and data/ arrives as a bind mount). A fixed relative path is wrong in one of the two.
DATA_DIR = Path(os.environ.get("DETECTOR_DATA_DIR") or Path(__file__).resolve().parents[2] / "data")
MODEL_PATH = DATA_DIR / "ring_model.joblib"
MODEL_CARD_PATH = DATA_DIR / "ring_model_card.json"

# Resolved once, on first use. `_state` is None until then; after that it is a dict that either
# carries a usable model or records exactly why there isn't one.
_state: dict[str, Any] | None = None


def _load() -> dict[str, Any]:
    global _state
    if _state is not None:
        return _state

    if not MODEL_PATH.exists() or not MODEL_CARD_PATH.exists():
        _state = {
            "available": False,
            "reason": (
                "No trained model on disk. Run: python3 services/detector-service/train_model.py "
                "--dataset hard --export (needs requirements-analysis.txt)."
            ),
        }
        return _state

    try:
        import joblib  # noqa: PLC0415 - optional dependency, deliberately imported late
    except ImportError:
        _state = {
            "available": False,
            "reason": (
                "scikit-learn/joblib are not installed in this environment, so the trained model "
                "cannot be loaded. The heuristic scorer is being used instead. Install "
                "services/detector-service/requirements-analysis.txt to enable it."
            ),
        }
        return _state

    try:
        card = json.loads(MODEL_CARD_PATH.read_text(encoding="utf-8"))
        expected = card.get("feature_names") or []

        # The check that stops silent nonsense. A model fitted on a different feature list will
        # still return confident-looking probabilities for the wrong reasons.
        if list(expected) != list(F.FEATURE_NAMES):
            _state = {
                "available": False,
                "reason": (
                    "The saved model was trained on a different feature set than features.py now "
                    "produces, so its scores would be meaningless. Retrain with train_model.py "
                    "--dataset hard --export."
                ),
                "card": card,
            }
            return _state

        model = joblib.load(MODEL_PATH)

        # A pickle is only guaranteed to mean the same thing under the scikit-learn version that
        # wrote it. Across versions sklearn itself warns that unpickling "might lead to breaking
        # code or invalid results", and an estimator that loads with a warning and then returns
        # confident-looking probabilities is the same silent-nonsense failure the feature-contract
        # check above exists to prevent - just from a different cause. This does not disable the
        # model on a mismatch, because refusing to score on a patch bump would be worse than
        # scoring, but it records the mismatch so GET /model can say it out loud instead of the
        # warning going to a log nobody reads.
        trained_with = card.get("sklearn_version")
        try:
            import sklearn  # noqa: PLC0415 - optional dependency, same reason as joblib above

            running = sklearn.__version__
        except ImportError:
            running = None
        version_mismatch = bool(trained_with and running and trained_with != running)

        _state = {
            "available": True,
            "model": model,
            "card": card,
            "threshold": float(card.get("operating_threshold", 0.5)),
            "needs_heuristic_feature": bool(card.get("expects_heuristic_score_feature")),
            "sklearn_trained_with": trained_with,
            "sklearn_running": running,
            "version_mismatch": version_mismatch,
        }
    except Exception as exc:  # noqa: BLE001 - any failure here must degrade, never propagate
        _state = {"available": False, "reason": f"Failed to load the trained model: {exc}"}

    return _state


def model_info() -> dict[str, Any]:
    """What the API and dashboard show about which brain is actually running."""
    state = _load()
    if not state.get("available"):
        return {"available": False, "reason": state.get("reason"), "scorer": "heuristic"}
    card = state["card"]
    return {
        "available": True,
        "scorer": "trained_model",
        "method": card.get("method"),
        "trained_at": card.get("trained_at"),
        "trained_on": card.get("trained_on"),
        "operating_threshold": state["threshold"],
        "held_out": card.get("held_out"),
        "held_out_average_precision": card.get("held_out_average_precision"),
        "caveat": card.get("honest_caveat"),
        "sklearn_trained_with": state.get("sklearn_trained_with"),
        "sklearn_running": state.get("sklearn_running"),
        "sklearn_version_mismatch": state.get("version_mismatch", False),
        "version_note": (
            "The saved model was pickled by a different scikit-learn version than this process is "
            "running. It still loads and scores, but sklearn does not guarantee cross-version "
            "unpickling. Re-export with train_model.py --dataset hard --export to clear this."
            if state.get("version_mismatch")
            else None
        ),
    }


def _top_contributions(model, vector: list[float], k: int = 4) -> list[dict[str, Any]]:
    """The features that pushed this particular cluster's score up.

    Global importances are a property of the model; a merchant looking at one held payment wants to
    know about THIS group. There is no exact per-prediction attribution available for a calibrated
    ensemble without adding a dependency, so this reports the highest-importance features that are
    actually elevated for this cluster, and the API labels it as indicative rather than exact. An
    approximate reason that is honestly labelled beats a precise-looking one that is invented.
    """
    try:
        inner = getattr(model, "calibrated_classifiers_", None)
        est = inner[0].estimator if inner else model
        importances = getattr(est, "feature_importances_", None)
        if importances is None:
            return []
        names = list(F.FEATURE_NAMES)
        pairs = [
            (names[i], float(importances[i]), float(vector[i]))
            for i in range(min(len(names), len(importances), len(vector)))
            if vector[i] > 0
        ]
        pairs.sort(key=lambda t: -t[1])
        return [
            {"feature": n, "importance": round(imp, 4), "value": round(val, 4)}
            for n, imp, val in pairs[:k]
        ]
    except Exception:  # noqa: BLE001 - an explanation failing must never fail a detection
        return []


def score(
    graph,
    members: set[str],
    accounts: list[dict],
    transactions: list[dict],
    heuristic_score: float,
) -> dict[str, Any] | None:
    """Score one cluster with the trained model, or return None if it is not usable.

    Returning None rather than raising is the whole contract: the caller treats it as "no model
    today" and uses the heuristic, and the response shape never changes.
    """
    state = _load()
    if not state.get("available"):
        return None

    try:
        vector = F.extract(graph, members, accounts, transactions)
        row = list(vector) + ([heuristic_score] if state["needs_heuristic_feature"] else [])
        proba = float(state["model"].predict_proba([row])[0][1])
        threshold = state["threshold"]
        return {
            "model_risk_score": round(proba, 4),
            "model_flagged": bool(proba >= threshold),
            "model_threshold": threshold,
            "model_method": state["card"].get("method"),
            "top_contributions": _top_contributions(state["model"], vector),
            "contribution_note": (
                "Indicative, not exact: these are the model's highest-importance features that are "
                "elevated for this group, not a per-prediction attribution."
            ),
        }
    except Exception as exc:  # noqa: BLE001
        # One bad cluster must not take down a detection run over thousands of them.
        return {"model_error": str(exc)[:200]}
