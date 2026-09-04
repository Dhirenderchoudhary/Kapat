"""Selects the detector's flagging threshold using ONLY the training split.

Why this file exists (Principle 5, and the AI Risk Manager track's "honest metrics" bar):
a detector that flags every community it finds has no decision boundary, and reporting its
"precision" is close to meaningless. Introducing a threshold fixes that - but choosing the
threshold by looking at test-set results would silently turn the held-out split into a tuning set
and make every number downstream of it dishonest.

So the threshold is chosen here, against data/detector_train.json only, and then applied
unchanged to the held-out split by evaluate.py. This script never opens detector_test.json - that
is the entire point, and it is enforced below rather than left as a comment.

Selection rule, fixed in advance rather than picked after seeing the curve: among all thresholds
that achieve maximum recall on train, take the one with the highest precision; break ties by
preferring the threshold furthest from the nearest scored cluster on either side (the widest
margin), so the choice sits in the middle of a stable band rather than balanced on a knife-edge
next to a cluster that a small data change could push across.

Writes data/threshold_selection.json: the full train-set precision/recall curve, the selected
threshold, and the margin around it, so the choice is auditable rather than asserted.

Usage: python3 select_threshold.py
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import cluster_scorer
import clustering
import graph_builder

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
TRAIN_DATA_PATH = DATA_DIR / "detector_train.json"
OUTPUT_PATH = DATA_DIR / "threshold_selection.json"

IOU_MATCH_THRESHOLD = 0.5
CANDIDATE_THRESHOLDS = [round(x / 100, 2) for x in range(5, 100, 5)]


def _iou(a: set[str], b: set[str]) -> float:
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def score_all(data: dict) -> list[dict]:
    accounts, transactions = data["accounts"], data["transactions"]
    graph = graph_builder.build_graph(accounts, transactions)
    predicted = clustering.find_clusters(graph)
    scored = []
    for cluster in predicted:
        score = cluster_scorer.score_cluster(graph, cluster, accounts=accounts, transactions=transactions)
        scored.append({"members": set(cluster), "risk_score": score["risk_score"]})
    return scored


def label_clusters(scored: list[dict], ground_truth: list[dict]) -> list[dict]:
    """Labels each predicted cluster by its best ground-truth match, so precision/recall at a
    given threshold can be computed the same way evaluate.py computes them."""
    true_rings = [g for g in ground_truth if g["kind"] == "true_ring"]
    labelled = []
    for entry in scored:
        best_kind, best_iou, best_id = None, 0.0, None
        for gt in ground_truth:
            iou = _iou(entry["members"], set(gt["account_ids"]))
            if iou > best_iou:
                best_kind, best_iou, best_id = gt["kind"], iou, gt["id"]
        labelled.append(
            {
                "risk_score": entry["risk_score"],
                "size": len(entry["members"]),
                "is_true_ring": best_kind == "true_ring" and best_iou >= IOU_MATCH_THRESHOLD,
                "matched_kind": best_kind,
                "matched_id": best_id,
                "best_iou": round(best_iou, 3),
                "members": entry["members"],
            }
        )
    return labelled, true_rings


def curve_point(labelled: list[dict], true_rings: list[dict], threshold: float) -> dict:
    flagged = [c for c in labelled if c["risk_score"] >= threshold]
    true_positives = [c for c in flagged if c["is_true_ring"]]

    recovered = 0
    for ring in true_rings:
        ring_ids = set(ring["account_ids"])
        if any(_iou(c["members"], ring_ids) >= IOU_MATCH_THRESHOLD for c in flagged):
            recovered += 1

    precision = len(true_positives) / len(flagged) if flagged else None
    recall = recovered / len(true_rings) if true_rings else None
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision is not None and recall is not None and (precision + recall) > 0
        else None
    )
    return {
        "threshold": threshold,
        "clusters_flagged": len(flagged),
        "true_rings_recovered": recovered,
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(recall, 4) if recall is not None else None,
        "f1": round(f1, 4) if f1 is not None else None,
        "lookalikes_flagged": sum(1 for c in flagged if c["matched_kind"] == "legitimate_lookalike"),
    }


def main() -> None:
    if not TRAIN_DATA_PATH.exists():
        raise SystemExit(f"Missing {TRAIN_DATA_PATH} - run generate_synthetic_data.py first.")

    data = json.loads(TRAIN_DATA_PATH.read_text(encoding="utf-8"))
    scored = score_all(data)
    labelled, true_rings = label_clusters(scored, data["ground_truth_clusters"])

    curve = [curve_point(labelled, true_rings, t) for t in CANDIDATE_THRESHOLDS]

    usable = [p for p in curve if p["recall"] is not None and p["precision"] is not None]
    if not usable:
        raise SystemExit("No usable threshold - train split produced no scored clusters.")

    max_recall = max(p["recall"] for p in usable)
    best_recall_points = [p for p in usable if p["recall"] == max_recall]
    best_precision = max(p["precision"] for p in best_recall_points)
    candidates = [p for p in best_recall_points if p["precision"] == best_precision]

    # Tie-break on widest margin: prefer the threshold sitting furthest from the nearest actual
    # cluster score, so a small data shift can't flip the decision.
    all_scores = sorted(c["risk_score"] for c in labelled)

    def margin(threshold: float) -> float:
        return min((abs(threshold - s) for s in all_scores), default=0.0)

    selected = max(candidates, key=lambda p: margin(p["threshold"]))

    flagged_band = [s for s in all_scores if s >= selected["threshold"]]
    unflagged_band = [s for s in all_scores if s < selected["threshold"]]
    separation = {
        "lowest_flagged_score": min(flagged_band) if flagged_band else None,
        "highest_unflagged_score": max(unflagged_band) if unflagged_band else None,
    }
    separation["margin"] = (
        round(separation["lowest_flagged_score"] - separation["highest_unflagged_score"], 4)
        if separation["lowest_flagged_score"] is not None and separation["highest_unflagged_score"] is not None
        else None
    )

    output = {
        "generated_at": datetime.now(UTC).isoformat(),
        "selected_on": "detector_train.json",
        "never_read": "detector_test.json",
        "selection_rule": (
            "Among thresholds achieving maximum recall on the TRAIN split, take the highest "
            "precision; break ties by widest margin to the nearest actual cluster score. Fixed in "
            "advance, not chosen after inspecting the curve."
        ),
        "selected_threshold": selected["threshold"],
        "train_metrics_at_selected_threshold": selected,
        "score_separation_on_train": separation,
        "curve": curve,
        "caveat": (
            "These are TRAIN-split numbers, used only to place the threshold. They are not the "
            "detector's reported performance - see data/detector_metrics.json, produced by "
            "evaluate.py against the held-out split using this threshold unchanged."
        ),
    }
    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")

    print(f"Train split: {len(labelled)} predicted clusters, {len(true_rings)} true rings")
    print(f"\n{'thresh':>7} {'flagged':>8} {'prec':>7} {'recall':>7} {'F1':>7} {'lookalikes':>11}")
    for p in curve:
        prec = f"{p['precision']:.3f}" if p["precision"] is not None else "  n/a"
        rec = f"{p['recall']:.3f}" if p["recall"] is not None else "  n/a"
        f1 = f"{p['f1']:.3f}" if p["f1"] is not None else "  n/a"
        mark = "  <-- SELECTED" if p["threshold"] == selected["threshold"] else ""
        print(f"{p['threshold']:>7} {p['clusters_flagged']:>8} {prec:>7} {rec:>7} {f1:>7} {p['lookalikes_flagged']:>11}{mark}")

    print(f"\nSelected threshold: {selected['threshold']}")
    print(f"Score separation on train: highest unflagged={separation['highest_unflagged_score']}, "
          f"lowest flagged={separation['lowest_flagged_score']}, margin={separation['margin']}")
    print(f"\nWrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
