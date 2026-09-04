"""Held-out precision/recall and false-positive cost (Architecture.md §7).

Phase 3. Runs the full graph_builder -> clustering -> cluster_scorer pipeline
against the held-out test split of generate_synthetic_data.py's output and prints honest
numbers - including how many legitimate look-alikes (shared households) were wrongly flagged,
and at what confidence (Phase 3 exit criteria, verbatim).

Never evaluates on the same synthetic batch the detector was tuned against (the explicit
anti-pattern): this script only ever reads data/detector_test.json, the split
generate_synthetic_data.py (Phase 1) carved out and never touches for tuning. If that file is
missing, this refuses to fall back to the train split silently - it errors out and says why.

Cluster matching uses intersection-over-union (IOU) against ground_truth_clusters, the only place
Phase 1's true labels exist. A predicted cluster "matches" a ground-truth group at IOU >=
IOU_MATCH_THRESHOLD - a judgment call (Principle 5), not a mathematical necessity: it
says a predicted cluster only counts as recovering a ring if it's substantially that ring, not
merely touching it.

No fabricated rupee cost (Principle 5): generate_synthetic_data.py does not model
chargebacks, merchant churn, or verification friction, so this script does not invent a currency
figure for false positives. What it prints instead is the literal, honest thing Phase 3's exit
criteria asks for - a count and a confidence distribution.

Since Phase 4, each predicted cluster's score also carries a transaction_risk
contribution and a chargeback_exposure_paise estimate (transaction_risk.py, chargeback_exposure.py)
- printed alongside each ring's recovery line below, traceable to the same transactions
throughout (see cluster_scorer.py's docstring for what "exposure" honestly means here).

Usage: python3 evaluate.py
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import cluster_scorer
import clustering
import graph_builder

TEST_DATA_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "detector_test.json"
METRICS_OUTPUT_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "detector_metrics.json"

# Judgment call, not derived from first principles - see module docstring.
IOU_MATCH_THRESHOLD = 0.5


def _iou(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def _best_match(predicted: set[str], ground_truth_clusters: list[dict]) -> tuple[dict | None, float]:
    best, best_score = None, 0.0
    for gt in ground_truth_clusters:
        score = _iou(predicted, set(gt["account_ids"]))
        if score > best_score:
            best, best_score = gt, score
    return best, best_score


def run_evaluation(data: dict) -> dict:
    accounts, transactions = data["accounts"], data["transactions"]
    ground_truth = data["ground_truth_clusters"]
    true_rings = [c for c in ground_truth if c["kind"] == "true_ring"]
    lookalikes = [c for c in ground_truth if c["kind"] == "legitimate_lookalike"]

    graph = graph_builder.build_graph(accounts, transactions)
    predicted = clustering.find_clusters(graph)
    scored = [
        {
            "members": cluster,
            "score": cluster_scorer.score_cluster(graph, cluster, accounts=accounts, transactions=transactions),
        }
        for cluster in predicted
    ]

    # The detector's decision boundary. Selected on the TRAIN split by select_threshold.py and
    # applied here unchanged - this script never re-tunes it (see that file's docstring). Clusters
    # below it are computed but never surfaced to a merchant, so they are not "flagged" and must
    # not be counted as either a hit or a false positive.
    threshold = cluster_scorer.FLAG_THRESHOLD
    flagged = [e for e in scored if e["score"]["risk_score"] >= threshold]

    # Recall: of the true rings actually embedded in the test split, how many did some FLAGGED
    # cluster substantially recover? A ring the pipeline clustered but scored below the threshold
    # is a miss, not a hit - counting it would flatter the detector for work the merchant never
    # sees.
    ring_details = []
    matched_true_rings = 0
    for ring in true_rings:
        ring_ids = set(ring["account_ids"])
        best_entry, best_iou = None, 0.0
        for entry in flagged:
            iou = _iou(entry["members"], ring_ids)
            if iou > best_iou:
                best_entry, best_iou = entry, iou
        recovered = best_iou >= IOU_MATCH_THRESHOLD
        matched_true_rings += int(recovered)
        ring_details.append(
            {
                "ring_id": ring["id"],
                "ground_truth_size": len(ring_ids),
                "recovered": recovered,
                "best_iou": round(best_iou, 3),
                "predicted_risk_score": best_entry["score"]["risk_score"] if best_entry else None,
                "chargeback_exposure_paise": best_entry["score"].get("chargeback_exposure_paise") if best_entry else None,
            }
        )
    recall = matched_true_rings / len(true_rings) if true_rings else None

    # Precision: of the clusters actually FLAGGED to the merchant, how many correspond to a real
    # ring rather than a look-alike group or nothing in ground truth at all?
    true_positive_predictions = 0
    false_positive_predictions = []
    for entry in flagged:
        best_gt, iou = _best_match(entry["members"], ground_truth)
        is_ring_match = best_gt is not None and best_gt["kind"] == "true_ring" and iou >= IOU_MATCH_THRESHOLD
        if is_ring_match:
            true_positive_predictions += 1
        else:
            false_positive_predictions.append(
                {
                    "members": sorted(entry["members"]),
                    "risk_score": entry["score"]["risk_score"],
                    "matched_ground_truth": best_gt["id"] if best_gt else None,
                    "matched_kind": best_gt["kind"] if best_gt else None,
                    "best_iou": round(iou, 3),
                }
            )
    precision = true_positive_predictions / len(flagged) if flagged else None

    # Reported alongside, deliberately: precision if the detector had NO decision boundary and
    # surfaced every community it found. This is what the previous version of this detector
    # actually did, and quoting only the thresholded number without it would hide where the
    # improvement came from.
    unthresholded_true_positives = sum(
        1
        for entry in scored
        if (lambda m: m[0] is not None and m[0]["kind"] == "true_ring" and m[1] >= IOU_MATCH_THRESHOLD)(
            _best_match(entry["members"], ground_truth)
        )
    )
    precision_no_threshold = unthresholded_true_positives / len(scored) if scored else None

    # The number Phase 3's exit criteria names explicitly: how many legitimate
    # look-alikes got wrongly flagged, and at what confidence.
    lookalike_outcomes = []
    for la in lookalikes:
        la_ids = set(la["account_ids"])
        best_entry, best_iou = None, 0.0
        for entry in scored:
            iou = _iou(entry["members"], la_ids)
            if iou > best_iou:
                best_entry, best_iou = entry, iou
        if best_entry is None or best_iou < IOU_MATCH_THRESHOLD:
            continue  # this look-alike group never got clustered as a unit at all
        score_obj = best_entry["score"]
        risk_score = score_obj["risk_score"]
        lookalike_outcomes.append(
            {
                "lookalike_id": la["id"],
                "size": len(la_ids),
                "predicted_risk_score": risk_score,
                "flagged": risk_score >= threshold,
                # Why it was held back, straight from the scorer rather than re-derived here.
                "ceiling_applied": score_obj.get("ceiling_applied"),
                "raw_risk_score": score_obj.get("raw_risk_score"),
                "signal_types_present": score_obj["features"].get("signal_types_present"),
                "flagged_high_confidence": risk_score >= cluster_scorer.HIGH_CONFIDENCE_THRESHOLD,
            }
        )
    n_wrongly_flagged = sum(1 for r in lookalike_outcomes if r["flagged"])
    n_wrongly_flagged_high_confidence = sum(1 for r in lookalike_outcomes if r["flagged_high_confidence"])

    return {
        "n_true_rings": len(true_rings),
        "n_lookalikes": len(lookalikes),
        "n_predicted_clusters": len(scored),
        "n_flagged_clusters": len(flagged),
        "flag_threshold": threshold,
        "threshold_selected_on": "detector_train.json (select_threshold.py) - never this file",
        "recall_true_rings": recall,
        "precision_predicted_clusters": precision,
        "precision_without_threshold": precision_no_threshold,
        "n_lookalikes_wrongly_flagged": n_wrongly_flagged,
        "ring_details": ring_details,
        "false_positive_predictions": false_positive_predictions,
        "lookalike_outcomes": lookalike_outcomes,
        "n_lookalikes_wrongly_flagged_high_confidence": n_wrongly_flagged_high_confidence,
        "high_confidence_threshold": cluster_scorer.HIGH_CONFIDENCE_THRESHOLD,
        "cost_model_note": (
            "No calibrated false-positive cost (rupees, chargeback rate, merchant churn) exists yet: "
            "generate_synthetic_data.py does not model chargebacks or verification friction, so a "
            "currency figure here would be invented, not measured (Principle 5). The honest "
            "cost signal is n_lookalikes_wrongly_flagged_high_confidence and the risk_score distribution "
            "above - each one is a real household that would see a hold or verification prompt it did "
            "nothing to earn."
        ),
    }


def _write_metrics_file(result: dict) -> None:
    """Persists the same numbers this script prints, so GET /api/metrics (Design.md §1.4) can
    surface real held-out detector performance without re-running the pipeline on every request.
    Written every run - this file is a cache of the last evaluate.py run, not a separate source of
    truth, and is regenerated deterministically from detector_test.json each time.
    """
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "test_data_file": TEST_DATA_PATH.name,
        "n_true_rings": result["n_true_rings"],
        "n_lookalikes": result["n_lookalikes"],
        "n_predicted_clusters": result["n_predicted_clusters"],
        "n_flagged_clusters": result["n_flagged_clusters"],
        "flag_threshold": result["flag_threshold"],
        "threshold_selected_on": result["threshold_selected_on"],
        "recall_true_rings": result["recall_true_rings"],
        "precision_predicted_clusters": result["precision_predicted_clusters"],
        "precision_without_threshold": result["precision_without_threshold"],
        "n_lookalikes_wrongly_flagged": result["n_lookalikes_wrongly_flagged"],
        "n_lookalikes_wrongly_flagged_high_confidence": result["n_lookalikes_wrongly_flagged_high_confidence"],
        "high_confidence_threshold": result["high_confidence_threshold"],
        "cost_model_note": result["cost_model_note"],
        "validity_caveat": (
            "These numbers are measured on a held-out split the detector never saw, which validates "
            "the IMPLEMENTATION. They cannot independently validate the detector's core ASSUMPTION - "
            "that honest households share an address but not a sequential phone block or a funnelled "
            "promo code - because generate_synthetic_data.py encodes that same assumption. Real "
            "validation needs real merchant data with real chargeback outcomes. See "
            "data/stress_test_report.json for adversarial cases where this detector demonstrably "
            "fails, including a legitimate flatmate group it wrongly flags."
        ),
    }
    METRICS_OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> None:
    # The per-ring lines below print a rupee exposure figure, and chargeback_exposure.py formats it
    # with a literal U+20B9. On a Windows console stdout defaults to cp1252, which cannot encode
    # that character, so this script used to write detector_metrics.json correctly and THEN die
    # with a UnicodeEncodeError while printing its own summary - looking like a failed evaluation
    # when the evaluation had in fact succeeded. Force UTF-8 on the way out.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    if not TEST_DATA_PATH.exists():
        raise SystemExit(
            f"{TEST_DATA_PATH} not found. Run generate_synthetic_data.py first (Phase 1). "
            "evaluate.py only ever scores the held-out test split - never the train split."
        )
    data = json.loads(TEST_DATA_PATH.read_text(encoding="utf-8"))
    result = run_evaluation(data)
    _write_metrics_file(result)

    print(f"Held-out test set ({TEST_DATA_PATH.name}): {result['n_true_rings']} true rings, "
          f"{result['n_lookalikes']} legitimate look-alikes")
    print(f"Predicted clusters: {result['n_predicted_clusters']}")
    print()
    recall_str = f"{result['recall_true_rings']:.1%}" if result["recall_true_rings"] is not None else "n/a"
    precision_str = f"{result['precision_predicted_clusters']:.1%}" if result["precision_predicted_clusters"] is not None else "n/a"
    print(f"Flag threshold (selected on TRAIN): {result['flag_threshold']}")
    print(f"Clusters computed: {result['n_predicted_clusters']}   Clusters FLAGGED to merchant: {result['n_flagged_clusters']}")
    print(f"Recall on true rings:              {recall_str}")
    print(f"Precision on flagged clusters:     {precision_str}")
    if result.get("precision_without_threshold") is not None:
        print(f"  (precision with NO threshold, i.e. surfacing every community found: "
              f"{result['precision_without_threshold']:.1%})")
    print()

    print("Per-ring recovery:")
    for d in result["ring_details"]:
        status = "RECOVERED" if d["recovered"] else "MISSED"
        exposure = d.get("chargeback_exposure_paise")
        exposure_str = f"  exposure=₹{exposure / 100:,.2f}" if exposure is not None else ""
        print(
            f"  {d['ring_id']} (n={d['ground_truth_size']}): {status:9s} "
            f"best_iou={d['best_iou']:.2f}  risk_score={d['predicted_risk_score']}{exposure_str}"
        )
    print()

    if result["false_positive_predictions"]:
        print(f"Predicted clusters that don't match a true ring ({len(result['false_positive_predictions'])}):")
        for fp in result["false_positive_predictions"]:
            print(
                f"  {len(fp['members'])} accounts, risk_score={fp['risk_score']}, "
                f"closest ground truth={fp['matched_ground_truth']} ({fp['matched_kind']}), iou={fp['best_iou']:.2f}"
            )
        print()

    threshold = result["high_confidence_threshold"]
    print(
        f"Legitimate look-alikes wrongly flagged at high confidence (risk_score >= {threshold}): "
        f"{result['n_lookalikes_wrongly_flagged_high_confidence']}/{result['n_lookalikes']}"
    )
    for r in result["lookalike_outcomes"]:
        marker = "  <-- HIGH-CONFIDENCE FALSE POSITIVE" if r["flagged_high_confidence"] else ""
        print(f"  {r['lookalike_id']} (n={r['size']}): risk_score={r['predicted_risk_score']}{marker}")
    print()

    print(result["cost_model_note"])


if __name__ == "__main__":
    main()
