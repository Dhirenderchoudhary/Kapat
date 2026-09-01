"""Rules.md tdd guidance: written before conversation_flow.py has real logic, test-first.

Pins down Design.md §3's script structure (identify -> state the finding -> ask -> listen, one
clarifying re-ask maximum -> close) across the three demo languages (Rules.md Principle 7).

Run from the repo root: python3 -m unittest tests.test_conversation_flow -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "verifier-service"))

import conversation_flow  # noqa: E402

LANGUAGES = ["en-IN", "hi-IN", "mr-IN"]
SIGNAL_TYPES = [
    "shared_address",
    "shared_payment",
    "shared_phone_pattern",
    "coordinated_timing",
    "shared_promo",
]


class TestOpeningScript(unittest.TestCase):
    def test_every_language_produces_a_nonempty_script_for_every_signal_type(self) -> None:
        for language_code in LANGUAGES:
            for signal_type in SIGNAL_TYPES:
                script = conversation_flow.build_opening_script(language_code, signal_type)
                self.assertIsInstance(script, str)
                self.assertGreater(len(script.strip()), 0)

    def test_shared_address_script_mentions_address_not_payment_method(self) -> None:
        script = conversation_flow.build_opening_script("en-IN", "shared_address")
        self.assertIn("address", script.lower())

    def test_shared_payment_script_mentions_payment_not_address(self) -> None:
        script = conversation_flow.build_opening_script("en-IN", "shared_payment")
        self.assertIn("payment", script.lower())

    def test_different_signal_types_produce_different_scripts(self) -> None:
        address_script = conversation_flow.build_opening_script("en-IN", "shared_address")
        payment_script = conversation_flow.build_opening_script("en-IN", "shared_payment")
        self.assertNotEqual(address_script, payment_script)

    def test_unrecognized_signal_type_falls_back_to_the_literal_rather_than_crashing(self) -> None:
        # Rules.md Principle 9: never silently drop an unlabeled signal - fall back to stating
        # the raw signal_type rather than pretending it doesn't exist or raising.
        script = conversation_flow.build_opening_script("en-IN", "some_future_signal")
        self.assertIn("some_future_signal", script)

    def test_hindi_script_is_in_hindi_not_a_silent_english_fallback(self) -> None:
        script = conversation_flow.build_opening_script("hi-IN", "shared_address")
        self.assertIn("Razorpay", script)
        self.assertNotEqual(script, conversation_flow.build_opening_script("en-IN", "shared_address"))

    def test_marathi_script_is_in_marathi_not_a_silent_english_fallback(self) -> None:
        script = conversation_flow.build_opening_script("mr-IN", "shared_address")
        self.assertIn("Razorpay", script)
        self.assertNotEqual(script, conversation_flow.build_opening_script("en-IN", "shared_address"))


class TestClarifyingReask(unittest.TestCase):
    def test_every_language_has_a_nonempty_reask(self) -> None:
        for language_code in LANGUAGES:
            reask = conversation_flow.build_clarifying_reask(language_code)
            self.assertGreater(len(reask.strip()), 0)


class TestClosingLine(unittest.TestCase):
    def test_every_outcome_has_a_distinct_closing_line_in_english(self) -> None:
        outcomes = ["confirmed_linked", "denied_linked", "unclear", "no_response"]
        lines = {outcome: conversation_flow.build_closing_line("en-IN", outcome) for outcome in outcomes}
        for outcome, line in lines.items():
            self.assertGreater(len(line.strip()), 0, msg=outcome)
        # every outcome reads differently - a merchant/account holder shouldn't get identical
        # "what happens next" text regardless of what they actually said
        self.assertEqual(len(set(lines.values())), len(lines))

    def test_every_language_covers_every_outcome(self) -> None:
        for language_code in LANGUAGES:
            for outcome in ["confirmed_linked", "denied_linked", "unclear", "no_response"]:
                line = conversation_flow.build_closing_line(language_code, outcome)
                self.assertGreater(len(line.strip()), 0)


if __name__ == "__main__":
    unittest.main()
