"""Phase 8 batch run (Phases.md): the full graph_builder -> clustering -> cluster_scorer
pipeline against the *complete* Phase 1 synthetic dataset (train + test combined - 396 accounts,
949 transactions - not just evaluate.py's held-out 120-account split), run unattended end to
end. This is the phase whose whole point is to surface a genuine failure, not to re-confirm
evaluate.py's already-reported numbers (Phases.md Phase 8: "this phase is also the most likely
source of your genuine 'what broke' story - leave real time for it").

Deliberately does NOT touch ground_truth_clusters for anything but labeling the report
afterward (same discipline as graph_builder.py itself, decision 18) - the pipeline never reads
its own answer key.

Writes data/batch_run_report.json: wall-clock time, cluster count/size distribution, any
exception (caught and reported, never swallowed silently - Rules.md Principle 5), and a
best-match summary against the combined ground truth so a real reader can see whether the extra
volume changed anything evaluate.py's 120-account run didn't already show.

Usage: python3 services/detector-service/run_batch.py
"""

from __future__ import annotations

import json
import time
import traceback
from pathlib import Path

import cluster_scorer
import clustering
import graph_builder

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
REPORT_PATH = DATA_DIR / "batch_run_report.json"


def _iou(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = a | b
    return len(a & b) / len(union) if union else 0.0


def load_combined_dataset() -> dict:
    train = json.loads((DATA_DIR / "detector_train.json").read_text(encoding="utf-8"))
    test = json.loads((DATA_DIR / "detector_test.json").read_text(encoding="utf-8"))

    train_account_ids = {a["id"] for a in train["accounts"]}
    test_account_ids = {a["id"] for a in test["accounts"]}
    overlap = train_account_ids & test_account_ids
    if overlap:
        # A real, structural problem if it ever happens - not something to merge past silently.
        raise ValueError(f"train/test account id overlap found ({len(overlap)} ids) - refusing to merge")

    return {
        "accounts": train["accounts"] + test["accounts"],
        "transactions": train["transactions"] + test["transactions"],
        "ground_truth_clusters": train["ground_truth_clusters"] + test["ground_truth_clusters"],
    }


def run_batch() -> dict:
    data = load_combined_dataset()
    accounts, transactions = data["accounts"], data["transactions"]
    ground_truth = data["ground_truth_clusters"]

    report: dict = {
        "input": {
            "account_count": len(accounts),
            "transaction_count": len(transactions),
            "ground_truth_cluster_count": len(ground_truth),
        },
        "exception": None,
    }

    start = time.monotonic()
    try:
        graph = graph_builder.build_graph(accounts, transactions)
        predicted = clustering.find_clusters(graph)
        scored = [
            {
                "members": sorted(cluster),
                "score": cluster_scorer.score_cluster(
                    graph, cluster, accounts=accounts, transactions=transactions
                ),
            }
            for cluster in predicted
        ]
    except Exception as exc:  # noqa: BLE001 - Phase 8's job is to surface this honestly, not hide it
        elapsed = time.monotonic() - start
        report["exception"] = {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()}
        report["elapsed_seconds"] = round(elapsed, 3)
        return report

    elapsed = time.monotonic() - start
    report["elapsed_seconds"] = round(elapsed, 3)
    report["graph"] = {"node_count": graph.number_of_nodes(), "edge_count": graph.number_of_edges()}
    report["predicted_cluster_count"] = len(scored)

    sizes = sorted((len(entry["members"]) for entry in scored), reverse=True)
    report["cluster_size_distribution"] = {
        "min": min(sizes) if sizes else None,
        "max": max(sizes) if sizes else None,
        "sizes": sizes,
    }
    risk_scores = [entry["score"]["risk_score"] for entry in scored]
    report["risk_score_distribution"] = {
        "min": round(min(risk_scores), 4) if risk_scores else None,
        "max": round(max(risk_scores), 4) if risk_scores else None,
        "mean": round(sum(risk_scores) / len(risk_scores), 4) if risk_scores else None,
    }

    # Best-match summary against the combined ground truth - not a formal precision/recall
    # report (that stays evaluate.py's job, on the held-out split alone, per Rules.md's
    # train/test discipline). This just checks whether more volume changed the qualitative
    # picture evaluate.py already reported.
    true_rings = [c for c in ground_truth if c["kind"] == "true_ring"]
    lookalikes = [c for c in ground_truth if c["kind"] == "legitimate_lookalike"]
    recovered_rings = 0
    for ring in true_rings:
        ring_ids = set(ring["account_ids"])
        best_iou = max((_iou(set(e["members"]), ring_ids) for e in scored), default=0.0)
        if best_iou >= 0.5:
            recovered_rings += 1
    lookalikes_at_high_confidence = 0
    for lookalike in lookalikes:
        lookalike_ids = set(lookalike["account_ids"])
        for entry in scored:
            if _iou(set(entry["members"]), lookalike_ids) >= 0.5 and entry["score"]["risk_score"] >= 0.6:
                lookalikes_at_high_confidence += 1
                break

    report["ground_truth_summary"] = {
        "true_ring_count": len(true_rings),
        "true_rings_recovered_at_iou_0.5": recovered_rings,
        "legitimate_lookalike_count": len(lookalikes),
        "legitimate_lookalikes_wrongly_flagged_high_confidence": lookalikes_at_high_confidence,
    }

    return report


def main() -> None:
    report = run_batch()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
