"""Integration test proving Phase 6's exit criteria (Phases.md): "a borderline synthetic cluster
runs through the full verify -> parse -> outcome cycle in at least one language."

Deliberately does not import services/verifier-service/main.py: that module needs fastapi/
pydantic, which this environment can't install (no network egress from this shell - see
Memory.md decision 19's identical constraint for the TypeScript side). This test instead
composes the same three modules main.py's /call handler chains together
(conversation_flow -> call_harness.simulated_call -> response_parser), which is exactly Phase 6's
real pipeline, per Rules.md's "one deep module, not two divergent ones" discipline already
established for services/detector-service/main.py. main.py's FastAPI layer itself is verified
separately, live, in an environment with network access - not silently assumed equivalent
(matching Memory.md's own precedent of never assuming untested layers are fine).

Run from the repo root: python3 -m unittest tests.test_verify_flow -v
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

_VERIFIER_DIR = Path(__file__).resolve().parents[1] / "services" / "verifier-service"
sys.path.insert(0, str(_VERIFIER_DIR))
sys.path.insert(0, str(_VERIFIER_DIR / "call_harness"))

import conversation_flow  # noqa: E402
import response_parser  # noqa: E402
import simulated_call  # noqa: E402

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "synthetic_response_test_set.json"


def run_verification(account_id: str, language_code: str, signal_type: str, transcript: str | None) -> dict:
    """Mirrors main.py's /call handler exactly (script -> simulated call -> parse), without the
    FastAPI wrapper."""
    script = conversation_flow.build_opening_script(language_code, signal_type)
    call_result = simulated_call.place_call(
        account_id, language_code, script, simulated_transcript=transcript
    )
    parsed = response_parser.parse(call_result["transcript"], language_code)
    closing = conversation_flow.build_closing_line(language_code, parsed["outcome"])
    return {**parsed, "transcript": call_result["transcript"], "closing_line": closing, "script": script}


class TestVerifyFlowBorderlineCluster(unittest.TestCase):
    """PRD.md §7 Flow B: two accounts share a delivery address (moderate confidence - could be a
    legitimate shared household). Voice verification asks about the linkage; both confirming
    they're family should come back "verified legitimate", not "ring"."""

    def test_flow_b_both_accounts_confirm_family_in_hindi(self) -> None:
        result_a = run_verification("acct_a", "hi-IN", "shared_address", "Haan, yeh mera bhai hai, hum saath rehte hain.")
        result_b = run_verification("acct_b", "hi-IN", "shared_address", "Ji haan, mujhe pata hai, woh mera bhai hai.")

        self.assertEqual(result_a["outcome"], "confirmed_linked")
        self.assertEqual(result_b["outcome"], "confirmed_linked")
        # confirmed_linked leans legitimate (Memory.md decision 14) - the closing line should
        # not read as an escalation.
        self.assertIn("action nahi", result_a["closing_line"].lower() + result_b["closing_line"].lower())
        self.assertIn("delivery address", result_a["script"].lower())

    def test_flow_c_one_account_denies_in_english(self) -> None:
        """PRD.md §7 Flow C: one account holder denies knowledge entirely - strengthens the ring
        hypothesis rather than resolving it as a household."""
        result = run_verification(
            "acct_c", "en-IN", "shared_payment", "No, I have no idea what account that is, never heard of it."
        )
        self.assertEqual(result["outcome"], "denied_linked")
        self.assertIn("payment", result["script"].lower())

    def test_flow_d_no_response_in_marathi(self) -> None:
        """PRD.md §7 Flow D: no answer - the dashboard should show "unconfirmed", not fabricate
        a result, and the cluster's evidence stays visible either way."""
        result = run_verification("acct_d", "mr-IN", "coordinated_timing", None)
        self.assertEqual(result["outcome"], "no_response")
        self.assertIsNone(result["confidence"])


class TestVerifyFlowAgainstSyntheticResponseSet(unittest.TestCase):
    """Runs a handful of real entries from data/synthetic_response_test_set.json (Phase 6's
    fixture, generate_synthetic_responses.py) through the same pipeline, across all three
    languages, closing the loop from generated data through to a parsed outcome."""

    @classmethod
    def setUpClass(cls) -> None:
        with open(DATA_PATH, encoding="utf-8") as f:
            cls.entries = json.load(f)

    def test_every_language_has_at_least_one_entry_that_parses_to_its_expected_outcome(self) -> None:
        for language_code in ["en-IN", "hi-IN", "mr-IN"]:
            matches = [e for e in self.entries if e["language_code"] == language_code]
            self.assertGreater(len(matches), 0, msg=f"no fixture entries for {language_code}")
            at_least_one_correct = False
            for entry in matches:
                result = run_verification(
                    entry["id"], language_code, "shared_address", entry["transcript"]
                )
                if result["outcome"] == entry["expected_outcome"]:
                    at_least_one_correct = True
                    break
            self.assertTrue(
                at_least_one_correct,
                msg=f"rules never matched any {language_code} fixture entry to its expected outcome",
            )


if __name__ == "__main__":
    unittest.main()
