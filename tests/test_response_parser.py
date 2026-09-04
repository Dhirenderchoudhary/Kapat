"""the governing principles tdd guidance: written before response_parser.py has real logic, test-first.

Directly encodes Design.md §3's response_parser outcome table and its
inverted meaning (confirming awareness leans *legitimate*, denying it *strengthens* the ring
hypothesis) - the whole point of this suite is to pin that inversion down so it can never
silently flip back to the single-transaction verifier's original meaning.

Run from the repo root: python3 -m unittest tests.test_response_parser -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "verifier-service"))

import response_parser  # noqa: E402


class TestResponseParserConfirmedLinked(unittest.TestCase):
    """"confirmed" = the account holder recognizes the linked account - leans legitimate."""

    def test_english_confirms_family_member(self) -> None:
        result = response_parser.parse(
            "Yes, that's my brother's account, we live at the same address.", "en-IN"
        )
        self.assertEqual(result["outcome"], "confirmed_linked")
        self.assertEqual(result["handled_by"], "rules")
        self.assertIsNotNone(result["confidence"])
        assert result["confidence"] is not None
        self.assertGreater(result["confidence"], 0.5)

    def test_hindi_confirms_family_member(self) -> None:
        result = response_parser.parse(
            "Haan, woh mere parivar ka account hai, mera bhai hai.", "hi-IN"
        )
        self.assertEqual(result["outcome"], "confirmed_linked")

    def test_marathi_confirms_family_member(self) -> None:
        result = response_parser.parse("Hoy, to mazya kutumbacha account aahe.", "mr-IN")
        self.assertEqual(result["outcome"], "confirmed_linked")

    def test_devanagari_script_confirms(self) -> None:
        result = response_parser.parse("हाँ, वो मेरे भाई का अकाउंट है।", "hi-IN")
        self.assertEqual(result["outcome"], "confirmed_linked")


class TestResponseParserDeniedLinked(unittest.TestCase):
    """"denied" = the account holder has no idea who the linked account belongs to -
    strengthens the ring hypothesis, the opposite of what "denied" suggests at first read."""

    def test_english_denies_knowledge(self) -> None:
        result = response_parser.parse(
            "No, I have no idea what account you're talking about.", "en-IN"
        )
        self.assertEqual(result["outcome"], "denied_linked")
        self.assertEqual(result["handled_by"], "rules")

    def test_hindi_denies_knowledge(self) -> None:
        result = response_parser.parse("Nahi, mujhe is account ke baare mein pata nahi hai.", "hi-IN")
        self.assertEqual(result["outcome"], "denied_linked")

    def test_marathi_denies_knowledge(self) -> None:
        result = response_parser.parse("Nahi, mala tya account baddal mahit nahi.", "mr-IN")
        self.assertEqual(result["outcome"], "denied_linked")


class TestResponseParserUnclear(unittest.TestCase):
    def test_hedging_transcript_is_unclear(self) -> None:
        result = response_parser.parse("Maybe, I'm not really sure, could be a relative.", "en-IN")
        self.assertEqual(result["outcome"], "unclear")

    def test_contradictory_transcript_is_unclear(self) -> None:
        # says both "yes I know" and "no idea" - rules can't safely pick one, per the governing principles
        # Principle 4 this is exactly the genuinely-ambiguous case, not a case to force-guess.
        result = response_parser.parse(
            "Yes I know them, actually no, I have no idea who that is.", "en-IN"
        )
        self.assertEqual(result["outcome"], "unclear")

    def test_no_recognizable_keywords_is_unclear_not_a_crash(self) -> None:
        result = response_parser.parse("The weather has been quite unpredictable lately.", "en-IN")
        self.assertEqual(result["outcome"], "unclear")
        self.assertEqual(result["handled_by"], "rules")


class TestResponseParserNoResponse(unittest.TestCase):
    def test_none_transcript_is_no_response(self) -> None:
        result = response_parser.parse(None, "en-IN")
        self.assertEqual(result["outcome"], "no_response")
        self.assertIsNone(result["confidence"])

    def test_empty_transcript_is_no_response(self) -> None:
        result = response_parser.parse("   ", "hi-IN")
        self.assertEqual(result["outcome"], "no_response")


class TestResponseParserReturnShape(unittest.TestCase):
    def test_return_dict_has_exactly_the_documented_keys(self) -> None:
        result = response_parser.parse("Yes, that's my sister.", "en-IN")
        self.assertEqual(set(result.keys()), {"outcome", "confidence", "handled_by"})

    def test_outcome_is_always_one_of_the_four_valid_values(self) -> None:
        valid = {"confirmed_linked", "denied_linked", "unclear", "no_response"}
        for transcript in [None, "", "Yes I know them", "No idea", "maybe", "gibberish xyz"]:
            result = response_parser.parse(transcript, "en-IN")
            self.assertIn(result["outcome"], valid)


if __name__ == "__main__":
    unittest.main()
