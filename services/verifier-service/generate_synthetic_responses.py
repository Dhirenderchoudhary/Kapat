"""Generates data/synthetic_response_test_set.json - synthetic account-holder call responses
for the verifier pipeline (Architecture.md §7).

Same discipline as services/detector-service/generate_synthetic_data.py:
stdlib-only, deterministic (fixed seed), committed output. Scope note: this is a Phase 6 fixture
that proves the verify -> parse -> outcome pipeline works end to end across all three demo
languages and all four outcomes (Phase 6 exit criteria) - it is NOT yet the held-out
accuracy report Phase 8 calls for ("Verifier accuracy measured against
synthetic_response_test_set.json"). That formal precision/recall-by-outcome evaluation
(evaluate_verifier.py, only ever reading this file, never used to hand-tune response_parser.py's
keyword banks) is real Phase 8 work, not fabricated here (Principle 5).

Run from the repo root: python3 services/verifier-service/generate_synthetic_responses.py
"""

from __future__ import annotations

import json
import random
from pathlib import Path

SEED = 42
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "data" / "synthetic_response_test_set.json"

LANGUAGES = ["en-IN", "hi-IN", "mr-IN"]

# Independent phrasing from response_parser.py's own keyword banks where possible - these read
# like something a real person would actually say, not a minimal keyword trigger. Some
# vocabulary overlap with the parser's keyword lists is unavoidable (there are only so many ways
# to say "yes I know them" in a given language), same as any closed-vocabulary rule-based system
# - the point of a held-out set here is to catch phrasing the rules don't cover, not to prove the
# rules against themselves.
_CONFIRMED_TEMPLATES = {
    "en-IN": [
        "Oh yes, that's my sister's account, we live together.",
        "That's my father's account actually, he shops from my address sometimes.",
        "Yeah I'm aware of it, it belongs to my roommate.",
        "Of course, that's my uncle, we share the same house.",
    ],
    "hi-IN": [
        "Haan ji, woh mera bhai hai, hum ek hi ghar mein rehte hain.",
        "Ji haan, yeh mummy ka account hai, unka phone mere paas hi hai.",
        "Haan mujhe pata hai, woh mera roommate hai.",
        "Bilkul, yeh mere chacha ka account hai.",
    ],
    "mr-IN": [
        "Hoy, to mazha bhau aahe, amhi ekach gharat rahato.",
        "Ho, ha aaicha account aahe, tyanchya jawal fon mazyakade astoy.",
        "Mala mahit aahe, to mazha roommate aahe.",
        "Nakkich, ha mazya kakancha account aahe.",
    ],
}

_DENIED_TEMPLATES = {
    "en-IN": [
        "No, I've never heard of that account before.",
        "I have absolutely no idea who that is.",
        "That's not mine, I don't know anyone by that name.",
        "No, I'm not aware of any such account, sorry.",
    ],
    "hi-IN": [
        "Nahi, maine kabhi is account ke baare mein nahi suna.",
        "Mujhe bilkul pata nahi yeh kiska account hai.",
        "Yeh mera nahi hai, main is naam ke kisi ko nahi jaanta.",
        "Nahi, mujhe iske baare mein koi jaankaari nahi hai.",
    ],
    "mr-IN": [
        "Nahi, mi ha account kadhi aikla nahi.",
        "Mala ha konacha account aahe he ekhi mahit nahi.",
        "Ha majha nahi, mi ya navachya konalahi olakhat nahi.",
        "Nahi, yababat mala kahi mahiti nahi.",
    ],
}

_UNCLEAR_TEMPLATES = {
    "en-IN": [
        "Hmm, maybe, I'm honestly not sure who that would be.",
        "It could be a relative but I really can't say for certain.",
        "I'm not sure, possibly someone from my extended family.",
    ],
    "hi-IN": [
        "Pata nahi thik se, shayad koi rishtedaar hoga.",
        "Mujhe yakeen nahi hai, ho sakta hai koi jaan-pehchaan ka ho.",
        "Shayad, lekin main pakka nahi bata sakta.",
    ],
    "mr-IN": [
        "Khatri nahi, kadachit natevaik asel.",
        "Mala thik mahit nahi, kadachit olakhicha koni asel.",
        "Kadachit, pan mi khatrine sangu shakat nahi.",
    ],
}

# no_response entries carry no transcript at all - the call genuinely wasn't answered.
_NO_RESPONSE_NOTE = "call not answered"


def generate() -> list[dict]:
    rng = random.Random(SEED)
    entries: list[dict] = []
    entry_id = 0

    for language_code in LANGUAGES:
        for transcript in _CONFIRMED_TEMPLATES[language_code]:
            entries.append(
                {
                    "id": f"resp_{entry_id:03d}",
                    "language_code": language_code,
                    "transcript": transcript,
                    "expected_outcome": "confirmed_linked",
                }
            )
            entry_id += 1
        for transcript in _DENIED_TEMPLATES[language_code]:
            entries.append(
                {
                    "id": f"resp_{entry_id:03d}",
                    "language_code": language_code,
                    "transcript": transcript,
                    "expected_outcome": "denied_linked",
                }
            )
            entry_id += 1
        for transcript in _UNCLEAR_TEMPLATES[language_code]:
            entries.append(
                {
                    "id": f"resp_{entry_id:03d}",
                    "language_code": language_code,
                    "transcript": transcript,
                    "expected_outcome": "unclear",
                }
            )
            entry_id += 1
        # A couple of genuine no_response entries per language, transcript is null on purpose.
        for _ in range(2):
            entries.append(
                {
                    "id": f"resp_{entry_id:03d}",
                    "language_code": language_code,
                    "transcript": None,
                    "expected_outcome": "no_response",
                    "note": _NO_RESPONSE_NOTE,
                }
            )
            entry_id += 1

    rng.shuffle(entries)
    return entries


def main() -> None:
    entries = generate()
    OUTPUT_PATH.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(entries)} entries to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
