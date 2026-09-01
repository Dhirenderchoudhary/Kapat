"""Rules.md tdd guidance: written before call_harness/simulated_call.py has real logic.

Pins down the harness contract every caller (main.py's /call handler, evaluate_verifier.py in a
later phase) depends on: {"transcript": str | None, "reached": bool}, matching a real
Twilio/Sarvam-backed harness's shape (Architecture.md §9) even though this one never does real
telephony/STT (Rules.md Principle 5 - it doesn't invent a transcript, the caller supplies one).

Run from the repo root: python3 -m unittest tests.test_simulated_call -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(
    0, str(Path(__file__).resolve().parents[1] / "services" / "verifier-service" / "call_harness")
)

import simulated_call  # noqa: E402


class TestPlaceCall(unittest.TestCase):
    def test_supplying_a_transcript_reports_reached_true(self) -> None:
        result = simulated_call.place_call(
            "acct_1", "en-IN", "some script text", simulated_transcript="Yes, I know them."
        )
        self.assertEqual(result, {"transcript": "Yes, I know them.", "reached": True})

    def test_no_transcript_reports_reached_false_not_a_fabricated_one(self) -> None:
        result = simulated_call.place_call("acct_1", "en-IN", "some script text")
        self.assertEqual(result, {"transcript": None, "reached": False})

    def test_return_shape_has_exactly_transcript_and_reached(self) -> None:
        result = simulated_call.place_call(
            "acct_1", "hi-IN", "script", simulated_transcript="Haan"
        )
        self.assertEqual(set(result.keys()), {"transcript", "reached"})


if __name__ == "__main__":
    unittest.main()
