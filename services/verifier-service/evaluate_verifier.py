"""Held-out verifier accuracy (Architecture.md §7, Phases.md Phase 8).

Runs response_parser.parse() against every entry in data/synthetic_response_test_set.json
(generate_synthetic_responses.py, Phase 6) and reports accuracy honestly - overall, broken down
by expected_outcome and by language_code, plus every misclassification listed by id so a wrong
answer is traceable, not just a percentage (Rules.md Principle 5).

This is Phase 8's own deliverable, deliberately deferred from Phase 6 (see conversation_flow.py/
generate_synthetic_responses.py's docstrings there) - Phase 6 only needed the verify -> parse ->
outcome pipeline to work end to end, not a formal accuracy report. response_parser.py's keyword
banks were written before this evaluation ever ran, test-first against hand-picked examples
(tests/test_response_parser.py), and were never adjusted to fit these exact fixture entries -
the modest vocabulary overlap that exists between the two is unavoidable in a closed-vocabulary
rule-based system (there are only so many ways to say "yes I know them" in a given language),
already disclosed in generate_synthetic_responses.py's own docstring.

Usage: python3 services/verifier-service/evaluate_verifier.py
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import response_parser

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "synthetic_response_test_set.json"
OUT_PATH = Path(__file__).resolve().parents[2] / "data" / "verifier_metrics.json"


def run_evaluation(entries: list[dict]) -> dict:
    total = len(entries)
    correct = 0
    by_outcome: dict[str, dict[str, int]] = defaultdict(lambda: {"correct": 0, "total": 0})
    by_language: dict[str, dict[str, int]] = defaultdict(lambda: {"correct": 0, "total": 0})
    misclassified: list[dict] = []

    for entry in entries:
        result = response_parser.parse(entry["transcript"], entry["language_code"])
        expected = entry["expected_outcome"]
        language_code = entry["language_code"]
        is_correct = result["outcome"] == expected

        by_outcome[expected]["total"] += 1
        by_language[language_code]["total"] += 1
        if is_correct:
            correct += 1
            by_outcome[expected]["correct"] += 1
            by_language[language_code]["correct"] += 1
        else:
            misclassified.append(
                {
                    "id": entry["id"],
                    "language_code": language_code,
                    "transcript": entry["transcript"],
                    "expected_outcome": expected,
                    "actual_outcome": result["outcome"],
                    "confidence": result["confidence"],
                }
            )

    def _rate(counts: dict[str, int]) -> float | None:
        return round(counts["correct"] / counts["total"], 4) if counts["total"] else None

    return {
        "total_entries": total,
        "correct": correct,
        "accuracy": round(correct / total, 4) if total else None,
        "accuracy_by_outcome": {k: _rate(v) for k, v in sorted(by_outcome.items())},
        "accuracy_by_language": {k: _rate(v) for k, v in sorted(by_language.items())},
        "counts_by_outcome": {k: dict(v) for k, v in sorted(by_outcome.items())},
        "counts_by_language": {k: dict(v) for k, v in sorted(by_language.items())},
        "misclassified": misclassified,
    }


def main() -> None:
    with open(DATA_PATH, encoding="utf-8") as f:
        entries = json.load(f)

    report = run_evaluation(entries)
    print(json.dumps(report, indent=2, ensure_ascii=False))

    OUT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {OUT_PATH}")


if __name__ == "__main__":
    main()
