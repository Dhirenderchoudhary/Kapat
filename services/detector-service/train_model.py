"""Trains and compares ring classifiers against the hand-built scorer, on two datasets.

WHAT THIS ANSWERS
=================
The detector ships a hand-built, corroboration-gated score (cluster_scorer.py): a judgment call
encoded as arithmetic. The obvious question is whether a trained model does better. This file
answers it rather than assuming either way, and it answers it twice, because the answer depends
entirely on which dataset you ask on.

  --dataset easy   the original split (generate_synthetic_data.py). Rings fire all five signals,
                   households fire one. EVERY method scores a perfect 1.000 here, including an
                   isolation forest fitted with no labels at all. That result is kept deliberately:
                   it is the proof that the number is measuring the exam, not the student.

  --dataset hard   the graded split (generate_hard_dataset.py). Rings range from sloppy to careful,
                   households from a shared address to flatmates passing one coupon around, and the
                   two classes genuinely overlap in signal space. Scores here are real, they sit
                   well below 1.000, and they are the ones worth quoting.

METHODOLOGY, AND WHY EACH CHOICE
================================
- The test split is read ONCE, at the end. Every selection decision happens inside the training
  split via stratified 5-fold cross-validation.
- AVERAGE PRECISION is the selection metric, not accuracy. Positives are a minority; accuracy
  rewards a model that predicts nothing.
- class_weight="balanced" rather than resampling, so reported precision and recall stay on the
  true class distribution instead of an invented one.
- Probabilities are CALIBRATED (isotonic, cross-validated). An uncalibrated forest's 0.8 is not
  80% confidence, and the cost model below multiplies by probability, so it has to mean something.
- The operating threshold is chosen by EXPECTED COST, not by F1. The buildathon brief asks for
  false-positive cost explicitly, and F1 silently asserts that a false positive and a false
  negative hurt equally, which for a merchant holding a real customer's money is not true.
- One model is a HYBRID: the heuristic's own risk score is handed to the classifier as a feature.
  If the trained models only win by re-deriving the heuristic, the hybrid will not pull ahead, and
  that is worth knowing either way.
- Feature extraction lives in features.py and is constrained to what the live webhook can compute.

Usage:
    python3 train_model.py --dataset hard      # the real comparison
    python3 train_model.py --dataset easy      # the saturation demonstration
    python3 train_model.py                     # both, written to data/model_comparison.json
"""

from __future__ import annotations

import argparse
import json
import random
import warnings
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import (
    ExtraTreesClassifier,
    GradientBoostingClassifier,
    HistGradientBoostingClassifier,
    IsolationForest,
    RandomForestClassifier,
)
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, precision_recall_fscore_support, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import cluster_scorer
import clustering
import features as F
import graph_builder

warnings.filterwarnings("ignore")

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
REPORT_PATH = DATA_DIR / "model_comparison.json"
MODEL_PATH = DATA_DIR / "ring_model.joblib"
MODEL_CARD_PATH = DATA_DIR / "ring_model_card.json"

IOU_MATCH = 0.5

SPLITS = {
    "easy": ("detector_train.json", "detector_test.json"),
    "hard": ("hard_train.json", "hard_test.json"),
}

# ---------------------------------------------------------------- cost model
#
# There is no measured rupee cost of a false positive in this project, and inventing one would be
# exactly the fabricated confidence the rest of the repo refuses. What CAN be stated honestly is a
# RATIO, as an explicit and arguable assumption: holding a legitimate customer's payment costs the
# merchant less in immediate rupees than letting a fraudulent one settle, but it is not free. It
# costs support time, and some of those customers do not come back.
#
# FP_COST 1 : FN_COST 4 is the default. It is a policy dial, not a measurement, and the report
# says so. A merchant with thin margins and loyal customers should run a different ratio than a
# marketplace, and changing it here moves the operating threshold, which is the intended behaviour.
FP_COST = 1.0
FN_COST = 4.0


def _iou(a: set, b: set) -> float:
    u = a | b
    return len(a & b) / len(u) if u else 0.0


def build_dataset(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, list]:
    """Runs the real pipeline over a split and labels each DETECTED cluster.

    Labelling detected clusters rather than ground-truth ones is deliberate: the model must learn
    to separate the groups the detector actually produces at runtime, including the ones Louvain
    merged or split, not an idealised set it will never be handed.

    Returns (features, labels, heuristic_scores, metadata).
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    accounts, transactions, truth = data["accounts"], data["transactions"], data["ground_truth_clusters"]

    graph = graph_builder.build_graph(accounts, transactions)
    clusters = clustering.find_clusters(graph)

    X, y, h, meta = [], [], [], []
    for members in clusters:
        best_kind, best_iou, best_difficulty = None, 0.0, None
        for gt in truth:
            iou = _iou(members, set(gt["account_ids"]))
            if iou > best_iou:
                best_kind, best_iou = gt["kind"], iou
                best_difficulty = gt.get("difficulty")
        label = 1 if (best_kind == "true_ring" and best_iou >= IOU_MATCH) else 0

        score = cluster_scorer.score_cluster(graph, members, accounts=accounts, transactions=transactions)
        X.append(F.extract(graph, members, accounts, transactions))
        y.append(label)
        h.append(score["risk_score"])
        meta.append(
            {
                "size": len(members),
                "label": label,
                "best_iou": round(best_iou, 3),
                "difficulty": best_difficulty if best_iou >= IOU_MATCH else None,
                "heuristic_score": score["risk_score"],
                "heuristic_flagged": bool(score["flagged"]),
            }
        )

    return np.array(X, dtype=float), np.array(y), np.array(h, dtype=float), meta


def models() -> dict:
    """Every model is calibrated, because the cost model multiplies by probability."""

    def cal(est):
        return CalibratedClassifierCV(est, method="isotonic", cv=3)

    return {
        "logistic_regression": Pipeline(
            [
                ("scale", StandardScaler()),
                ("clf", LogisticRegression(class_weight="balanced", max_iter=4000, random_state=42)),
            ]
        ),
        "random_forest": cal(
            RandomForestClassifier(
                n_estimators=500, max_depth=8, min_samples_leaf=2,
                class_weight="balanced", random_state=42, n_jobs=-1,
            )
        ),
        "extra_trees": cal(
            ExtraTreesClassifier(
                n_estimators=500, max_depth=10, min_samples_leaf=2,
                class_weight="balanced", random_state=42, n_jobs=-1,
            )
        ),
        "gradient_boosting": cal(GradientBoostingClassifier(random_state=42)),
        "hist_gradient_boosting": cal(
            HistGradientBoostingClassifier(max_iter=300, learning_rate=0.08, random_state=42)
        ),
    }


def _hybrid_model():
    return CalibratedClassifierCV(
        RandomForestClassifier(
            n_estimators=500, max_depth=8, min_samples_leaf=2,
            class_weight="balanced", random_state=42, n_jobs=-1,
        ),
        method="isotonic",
        cv=3,
    )


def metrics_at(y_true: np.ndarray, proba: np.ndarray, threshold: float) -> dict:
    pred = (proba >= threshold).astype(int)
    p, r, f1, _ = precision_recall_fscore_support(y_true, pred, average="binary", zero_division=0)
    tp = int(((pred == 1) & (y_true == 1)).sum())
    fp = int(((pred == 1) & (y_true == 0)).sum())
    fn = int(((pred == 0) & (y_true == 1)).sum())
    tn = int(((pred == 0) & (y_true == 0)).sum())
    return {
        "threshold": round(float(threshold), 4),
        "precision": round(float(p), 4),
        "recall": round(float(r), 4),
        "f1": round(float(f1), 4),
        "true_positives": tp,
        "false_positives": fp,
        "false_negatives": fn,
        "true_negatives": tn,
        "expected_cost": round(fp * FP_COST + fn * FN_COST, 2),
    }


def choose_threshold_by_cost(y_true: np.ndarray, proba: np.ndarray) -> tuple[float, list[dict]]:
    """Pick the operating point that minimises expected cost, and return the whole curve.

    Called ONLY with training-split scores. Returning the curve as well as the argmin matters: a
    threshold sitting on a sharp spike is fragile even when its number looks best, and a reader can
    see that from the curve and not from the scalar.
    """
    curve = [metrics_at(y_true, proba, float(t)) for t in np.arange(0.05, 0.96, 0.025)]
    best = min(curve, key=lambda m: (m["expected_cost"], -m["recall"]))
    return best["threshold"], curve


def evaluate_split(name: str, train_path: Path, test_path: Path) -> dict:
    X_tr, y_tr, h_tr, _ = build_dataset(train_path)
    X_te, y_te, h_te, meta_te = build_dataset(test_path)

    print(f"\n=== {name} split ===")
    print(f"train {len(y_tr):>4} detected clusters, {int(y_tr.sum()):>3} rings ({y_tr.mean():.1%} positive)")
    print(f"test  {len(y_te):>4} detected clusters, {int(y_te.sum()):>3} rings ({y_te.mean():.1%} positive)")

    # The hybrid gets the heuristic's own verdict as an extra column. If the trained models are
    # only re-deriving the heuristic, handing it to them for free will not help them.
    X_tr_h = np.column_stack([X_tr, h_tr])
    X_te_h = np.column_stack([X_te, h_te])

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    results: dict[str, dict] = {}

    def run(key: str, model, Xtr, Xte, label: str):
        cv_ap = cross_val_score(model, Xtr, y_tr, cv=cv, scoring="average_precision", n_jobs=-1)
        model.fit(Xtr, y_tr)
        proba_tr = model.predict_proba(Xtr)[:, 1]
        proba_te = model.predict_proba(Xte)[:, 1]
        thr, curve = choose_threshold_by_cost(y_tr, proba_tr)  # training split only
        results[key] = {
            "cv_average_precision_mean": round(float(cv_ap.mean()), 4),
            "cv_average_precision_std": round(float(cv_ap.std()), 4),
            "test_average_precision": round(float(average_precision_score(y_te, proba_te)), 4),
            "test_roc_auc": round(float(roc_auc_score(y_te, proba_te)), 4) if len(set(y_te)) > 1 else None,
            "operating_threshold": thr,
            "threshold_chosen_on": "training split, by minimum expected cost",
            "test_at_operating_threshold": metrics_at(y_te, proba_te, thr),
            "cost_curve_on_train": curve,
        }
        m = results[key]["test_at_operating_threshold"]
        print(
            f"{label:26} CV AP {cv_ap.mean():.3f}  test AP {results[key]['test_average_precision']:.3f}"
            f"  P {m['precision']:.3f}  R {m['recall']:.3f}  cost {m['expected_cost']:.0f}"
        )
        return proba_te

    for key, model in models().items():
        run(key, model, X_tr, X_te, key)
    run("hybrid_heuristic_plus_model", _hybrid_model(), X_tr_h, X_te_h, "hybrid (heuristic+RF)")

    # Unsupervised control. If this matches the supervised models, the labels were never doing any
    # work and the split is saturated.
    iso = IsolationForest(random_state=42, contamination=float(min(max(y_tr.mean(), 0.02), 0.5)))
    iso.fit(X_tr)
    iso_scores = -iso.score_samples(X_te)
    results["isolation_forest_unsupervised"] = {
        "note": "Trained with NO labels. Included to test whether the labels are doing real work.",
        "test_average_precision": round(float(average_precision_score(y_te, iso_scores)), 4),
        "test_roc_auc": round(float(roc_auc_score(y_te, iso_scores)), 4) if len(set(y_te)) > 1 else None,
    }
    print(f"{'isolation_forest':26} (no labels)      test AP {results['isolation_forest_unsupervised']['test_average_precision']:.3f}")

    # The incumbent, scored identically on the same clusters.
    results["heuristic_corroboration_gated"] = {
        "note": "The hand-built scorer in production. No training, no labels used.",
        "test_average_precision": round(float(average_precision_score(y_te, h_te)), 4),
        "test_roc_auc": round(float(roc_auc_score(y_te, h_te)), 4) if len(set(y_te)) > 1 else None,
        "operating_threshold": cluster_scorer.FLAG_THRESHOLD,
        "threshold_chosen_on": "training split, by select_threshold.py's fixed rule",
        "test_at_operating_threshold": metrics_at(y_te, h_te, cluster_scorer.FLAG_THRESHOLD),
    }
    hm = results["heuristic_corroboration_gated"]["test_at_operating_threshold"]
    print(
        f"{'heuristic (shipped)':26} no training       test AP {results['heuristic_corroboration_gated']['test_average_precision']:.3f}"
        f"  P {hm['precision']:.3f}  R {hm['recall']:.3f}  cost {hm['expected_cost']:.0f}"
    )

    ranked = [
        (k, v["test_at_operating_threshold"]["expected_cost"])
        for k, v in results.items()
        if "test_at_operating_threshold" in v
    ]
    ranked.sort(key=lambda kv: kv[1])

    # Where on the difficulty ladder does each method actually break?
    best_key = ranked[0][0]
    by_difficulty: dict[str, dict] = {}
    if best_key != "heuristic_corroboration_gated":
        needs_h = best_key.startswith("hybrid")
        model = _hybrid_model() if needs_h else models()[best_key]
        model.fit(X_tr_h if needs_h else X_tr, y_tr)
        best_proba = model.predict_proba(X_te_h if needs_h else X_te)[:, 1]
        best_thr = results[best_key]["operating_threshold"]
        for m, p in zip(meta_te, best_proba):
            d = m["difficulty"]
            if d is None:
                continue
            b = by_difficulty.setdefault(d, {"n": 0, "model_correct": 0, "heuristic_correct": 0})
            want = m["label"] == 1
            b["n"] += 1
            b["model_correct"] += int(bool(p >= best_thr) == want)
            b["heuristic_correct"] += int(m["heuristic_flagged"] == want)

    return {
        "dataset": {
            "train_file": train_path.name,
            "test_file": test_path.name,
            "train_clusters": int(len(y_tr)),
            "train_positives": int(y_tr.sum()),
            "test_clusters": int(len(y_te)),
            "test_positives": int(y_te.sum()),
            "n_features": len(F.FEATURE_NAMES),
        },
        "results": results,
        "ranking_by_expected_cost": [{"method": k, "expected_cost": c} for k, c in ranked],
        "per_difficulty": dict(sorted(by_difficulty.items())),
        "feature_importance": feature_importance(X_tr, y_tr),
    }


def feature_importance(X_tr: np.ndarray, y_tr: np.ndarray) -> list[dict]:
    """Uncalibrated forest, purely to read importances off it: CalibratedClassifierCV hides them."""
    rf = RandomForestClassifier(
        n_estimators=500, max_depth=8, min_samples_leaf=2,
        class_weight="balanced", random_state=42, n_jobs=-1,
    )
    rf.fit(X_tr, y_tr)
    return sorted(
        ({"feature": n, "importance": round(float(v), 4)} for n, v in zip(F.FEATURE_NAMES, rf.feature_importances_)),
        key=lambda d: -d["importance"],
    )[:15]


def adversarial_evaluation(fitted_by_split: dict) -> dict:
    """Score the shipped heuristic and each split's best trained model against stress_test.py.

    These ten populations were authored by hand to break assumptions, never sampled from either
    generator, and never used for tuning. A model that wins on a test split and loses here has
    memorised its generator, and saying so is worth more than a leaderboard number.
    """
    import stress_test

    rows = []
    for case_spec in stress_test.CASES:
        rng = random.Random(hash(case_spec["name"]) % (2**31))
        spec = dict(case_spec)
        name, size = spec.pop("name"), spec.pop("size")
        expectation, note = spec.pop("expectation"), spec.pop("note")

        _meta, accounts, transactions, ids = stress_test.build_case(
            name, rng=rng, size=size, expectation=expectation, note=note, **spec
        )
        graph = graph_builder.build_graph(accounts, transactions)
        members = set(ids)
        want = expectation == "flagged"

        h = cluster_scorer.score_cluster(graph, members, accounts=accounts, transactions=transactions)
        per_method = {
            "heuristic_corroboration_gated": {
                "score": h["risk_score"],
                "flagged": bool(h["flagged"]),
                "correct": bool(h["flagged"] == want),
            }
        }

        feats = np.array([F.extract(graph, members, accounts, transactions)], dtype=float)
        for split_name, (model, thr, needs_h) in fitted_by_split.items():
            x = np.column_stack([feats, [[h["risk_score"]]]]) if needs_h else feats
            p = float(model.predict_proba(x)[0, 1])
            per_method[f"best_model_{split_name}_split"] = {
                "score": round(p, 4),
                "flagged": bool(p >= thr),
                "correct": bool((p >= thr) == want),
            }

        rows.append({"case": name, "expectation": expectation, "note": note, "methods": per_method})

    summary = {}
    for m in rows[0]["methods"]:
        wrong = [r for r in rows if not r["methods"][m]["correct"]]
        summary[m] = {
            "correct": len(rows) - len(wrong),
            "total": len(rows),
            "accuracy": round((len(rows) - len(wrong)) / len(rows), 4),
            "failures": [
                {
                    "case": r["case"],
                    "expected": r["expectation"],
                    "score": r["methods"][m]["score"],
                    "kind": "false_positive" if r["expectation"] == "not_flagged" else "false_negative",
                }
                for r in wrong
            ],
        }
    return {
        "what_this_measures": (
            "Ten hand-authored populations neither generator produces: households sharing two or "
            "three things, rings sharing almost nothing. Written before any model existed, never "
            "used for tuning."
        ),
        "per_case": rows,
        "summary": summary,
    }


def export_model(split: dict, train_path: Path) -> dict:
    """Fit the winning method on the training split and write it to disk for the live service.

    This is the step that turns the comparison into a product. Without it the trained model is a
    number in a report and the running agent still scores every payment with the hand-built rule
    alone - which is exactly the gap this file used to leave open.

    Two things ship together and must never be separated:

      ring_model.joblib      the fitted, calibrated estimator
      ring_model_card.json   what it was trained on, when, which features in which order, the
                             operating threshold, and the held-out numbers it earned

    The card is not documentation-for-its-own-sake. model_scorer.py refuses to load a model whose
    feature list does not match the extractor it is running against, and it can only do that check
    because the card records the order. A model silently fed features in a different order is the
    kind of bug that produces plausible-looking scores forever.
    """
    best = split["ranking_by_expected_cost"][0]["method"]
    if best == "heuristic_corroboration_gated":
        print("\nBest method is the heuristic itself - nothing to export.")
        return {"exported": False, "reason": "heuristic won; no trained model beats it"}

    X_tr, y_tr, h_tr, _ = build_dataset(train_path)
    needs_h = best.startswith("hybrid")
    model = _hybrid_model() if needs_h else models()[best]
    model.fit(np.column_stack([X_tr, h_tr]) if needs_h else X_tr, y_tr)

    joblib.dump(model, MODEL_PATH)

    r = split["results"][best]
    card = {
        "method": best,
        "trained_at": datetime.now(UTC).isoformat(),
        "trained_on": train_path.name,
        "feature_names": F.FEATURE_NAMES,
        # The hybrid appends the heuristic's own risk score as a final column. The live scorer has
        # to know that, or it will hand the model a vector one short.
        "expects_heuristic_score_feature": needs_h,
        "n_features": len(F.FEATURE_NAMES) + (1 if needs_h else 0),
        "operating_threshold": r["operating_threshold"],
        "threshold_chosen_on": r["threshold_chosen_on"],
        "cost_model": {"false_positive_cost": FP_COST, "false_negative_cost": FN_COST},
        "held_out": r["test_at_operating_threshold"],
        "held_out_average_precision": r["test_average_precision"],
        "honest_caveat": (
            "These numbers come from synthetic data whose generator encodes an assumption about "
            "how rings behave. They validate the implementation, not the assumption. Real "
            "merchant traffic with real chargeback outcomes is what would validate the latter."
        ),
    }
    MODEL_CARD_PATH.write_text(json.dumps(card, indent=2) + "\n", encoding="utf-8")

    m = r["test_at_operating_threshold"]
    print(f"\nExported {best} -> {MODEL_PATH.name}")
    print(f"  threshold {r['operating_threshold']}  precision {m['precision']:.3f}  recall {m['recall']:.3f}")
    return {"exported": True, "method": best, "path": str(MODEL_PATH)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["easy", "hard", "both"], default="both")
    ap.add_argument(
        "--export",
        action="store_true",
        help="Fit the winning model on the hard split and write it for the live detector to use.",
    )
    args = ap.parse_args()

    wanted = ["easy", "hard"] if args.dataset == "both" else [args.dataset]
    splits = {}
    for name in wanted:
        tr, te = SPLITS[name]
        if not (DATA_DIR / tr).exists() or not (DATA_DIR / te).exists():
            print(f"skipping {name}: {tr}/{te} not found (run generate_hard_dataset.py)")
            continue
        splits[name] = evaluate_split(name, DATA_DIR / tr, DATA_DIR / te)

    # Refit each split's winner so the adversarial suite can score it.
    fitted_for_adversarial = {}
    for name in splits:
        best = splits[name]["ranking_by_expected_cost"][0]["method"]
        if best == "heuristic_corroboration_gated":
            continue
        tr, _te = SPLITS[name]
        X_tr, y_tr, h_tr, _ = build_dataset(DATA_DIR / tr)
        needs_h = best.startswith("hybrid")
        model = _hybrid_model() if needs_h else models()[best]
        model.fit(np.column_stack([X_tr, h_tr]) if needs_h else X_tr, y_tr)
        fitted_for_adversarial[name] = (model, splits[name]["results"][best]["operating_threshold"], needs_h)

    adversarial = adversarial_evaluation(fitted_for_adversarial)

    print("\nAdversarial suite (10 hand-authored cases):")
    for m, s in sorted(adversarial["summary"].items(), key=lambda kv: -kv[1]["accuracy"]):
        fails = ", ".join(f["case"] for f in s["failures"]) or "-"
        print(f"  {m:32} {s['correct']}/{s['total']}   {fails}")

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "feature_names": F.FEATURE_NAMES,
        "cost_model": {
            "false_positive_cost": FP_COST,
            "false_negative_cost": FN_COST,
            "units": "relative, not rupees",
            "why_not_rupees": (
                "No chargeback rate, no verification-friction cost and no churn rate has been "
                "measured for this merchant, so a rupee figure would be invented. The ratio is an "
                "explicit, arguable policy dial: it says letting a fraudulent payment settle hurts "
                "four times as much as holding a legitimate one. Change it and the operating "
                "threshold moves, which is the intended behaviour."
            ),
        },
        "methodology": {
            "selection_metric": "average precision (area under the PR curve)",
            "cross_validation": "stratified 5-fold, inside the training split only",
            "calibration": "isotonic, cross-validated - required because the cost model multiplies by probability",
            "class_imbalance": "class_weight='balanced', not resampling, so precision/recall stay on the true distribution",
            "threshold_rule": "minimum expected cost on the TRAINING split; test split read once at the end",
            "feature_constraint": "every feature is computable at detection time from fields the Razorpay payments API returns",
        },
        "splits": splits,
        "adversarial_evaluation": adversarial,
    }

    if "hard" in splits and "easy" in splits:
        e = splits["easy"]["results"]
        h = splits["hard"]["results"]
        report["headline"] = {
            "easy_split_is_saturated": (
                f"On the original split every method scores about "
                f"{e['heuristic_corroboration_gated']['test_average_precision']:.3f} average precision, "
                f"including an isolation forest trained with no labels "
                f"({e['isolation_forest_unsupervised']['test_average_precision']:.3f}). That number is "
                "measuring the dataset, not the detector."
            ),
            "hard_split_is_the_real_number": (
                "On the graded split, where rings range from sloppy to careful and households share up "
                "to four signals, the methods separate and nothing reaches 1.000. Those are the numbers "
                "worth quoting."
            ),
            "best_on_hard": splits["hard"]["ranking_by_expected_cost"][0],
            "heuristic_on_hard": {
                "method": "heuristic_corroboration_gated",
                "expected_cost": h["heuristic_corroboration_gated"]["test_at_operating_threshold"]["expected_cost"],
                "precision": h["heuristic_corroboration_gated"]["test_at_operating_threshold"]["precision"],
                "recall": h["heuristic_corroboration_gated"]["test_at_operating_threshold"]["recall"],
            },
        }

    if args.export and "hard" in splits:
        report["exported_model"] = export_model(splits["hard"], DATA_DIR / SPLITS["hard"][0])
    elif args.export:
        print("\n--export needs the hard split; run generate_hard_dataset.py first.")

    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
