"""Parses a call transcript into a verification outcome (Design.md §3, Principle 4).

Rule-based first, LLM-assisted only for genuinely ambiguous transcripts (Principle 4).
As of Phase 6 the LLM-assist path is NOT wired: no LLM API credential exists in this repo, and
faking an "llm"-handled result without actually calling one would violate Principle 5
(no fabricated confidence). So every result here is `handled_by: "rules"` - a transcript the
keyword rules genuinely can't classify comes back `unclear` honestly, rather than a guessed
answer dressed up as LLM output. Wiring a real LLM fallback for the unclear bucket is a
documented next step, not a build target for this phase (the anti-pattern warning against
scope creep applies here too).

Outcome meaning is inverted vs. a single-transaction verifier (restated
in packages/db/src/schema/fraud.ts on the verifications table):
  - confirmed_linked: the account holder confirms awareness of the linked account - leans
    legitimate (family/shared household).
  - denied_linked: the account holder denies any knowledge of the linked account - strengthens
    the ring hypothesis.
  - unclear: ambiguous, one clarifying re-ask exhausted (conversation_flow.py handles the
    re-ask; this module just classifies whatever final transcript it's handed).
  - no_response: unreachable (call_harness reported `reached: False`, or the transcript is
    empty/whitespace-only).
"""

from __future__ import annotations

import re

# Keyword banks for Design.md §3's three demo languages only (Principle 7: the
# architecture supports Sarvam's full language catalog, but only hi-IN/en-IN/mr-IN are ever
# claimed to work live). Both Devanagari and common romanized spellings are included, since
# Sarvam's STT (saaras:v3) or a human running the simulated-call demo could produce either.
_CONFIRM_KEYWORDS: dict[str, list[str]] = {
    "en-IN": [
        "yes", "yeah", "yep", "i know", "i'm aware", "im aware", "aware of", "that's my",
        "thats my", "family", "brother", "sister", "father", "mother", "husband", "wife",
        "roommate", "flatmate", "relative", "we share", "recognize", "recognise",
    ],
    "hi-IN": [
        "haan", "हां", "हाँ", "pata hai", "पता है", "jaanta hoon", "jaanti hoon", "जानता हूं",
        "जानती हूं", "जानता हूँ", "जानती हूँ", "parivar", "परिवार", "bhai", "भाई", "behen", "बहन",
        "ghar ka", "घर का", "pehchaanta", "pehchaanti", "chacha", "चाचा", "mama", "मामा",
    ],
    "mr-IN": [
        "hoy", "होय", "माहित आहे", "mahit aahe", "kutumb", "कुटुंब", "bhau", "भाऊ", "bahin",
        "बहीण", "olakhto", "olakhte", "kaka", "काका", "aai", "आई",
    ],
}

_DENY_KEYWORDS: dict[str, list[str]] = {
    "en-IN": [
        "no idea", "not aware", "don't know", "dont know", "never heard", "not mine",
        "stranger", "not my", "unaware", "no clue",
    ],
    "hi-IN": [
        "nahi", "नहीं", "pata nahi", "पता नहीं", "jaanta nahi", "जानता नहीं", "jaanti nahi",
        "जानती नहीं", "koi jaan pehchaan nahi",
    ],
    "mr-IN": [
        "nahi", "नाही", "माहित नाही", "mahit nahi", "olakh nahi", "ओळख नाही",
    ],
}

_HEDGE_KEYWORDS: dict[str, list[str]] = {
    "en-IN": ["maybe", "not sure", "not really sure", "i think", "possibly", "might be", "could be"],
    "hi-IN": ["shayad", "शायद", "thik se pata nahi", "yakeen nahi"],
    "mr-IN": ["kadachit", "कदाचित", "khatri nahi"],
}

_VALID_LANGUAGES = ("en-IN", "hi-IN", "mr-IN")


def _count_all_hits(
    transcript_lower: str,
    confirm_keywords: list[str],
    deny_keywords: list[str],
    hedge_keywords: list[str],
) -> tuple[int, int, int]:
    """Counts confirm/deny/hedge keyword hits with ONE shared non-overlapping span map across
    all three categories combined - not three independent passes.

    Real bug this fixed: with three separate passes, a short keyword
    nested inside a longer one double-counted the same evidence within its own category (deny's
    "nahi" sitting inside "mahit nahi" made one denial phrase look like two, occasionally
    outweighing a genuine hedge signal elsewhere in the sentence), *and* a keyword from a
    different category could piggyback on the same overlapping text (confirm's "aware of"
    matching inside deny's "not aware of" manufactured a false contradiction, since each
    category's pass had its own blank slate and neither saw what the other had already claimed).
    Sorting every keyword from every category together, longest first, and tracking one shared
    consumed-positions map fixes both: whichever phrase is longer and more specific wins a
    contested span, and nothing else may match a position it already covers.
    """
    tagged = (
        [(kw, "confirm") for kw in confirm_keywords]
        + [(kw, "deny") for kw in deny_keywords]
        + [(kw, "hedge") for kw in hedge_keywords]
    )
    # Longest keyword first; ties broken so a substantive claim (confirm/deny) always outranks a
    # same-length hedge word, and deny edges out confirm deterministically rather than by
    # incidental list order (the two vocabularies are distinct enough that this tiebreak rarely
    # matters in practice).
    priority = {"deny": 0, "confirm": 1, "hedge": 2}
    tagged_unique = sorted(set(tagged), key=lambda t: (-len(t[0]), priority[t[1]]))

    consumed = [False] * len(transcript_lower)
    counts = {"confirm": 0, "deny": 0, "hedge": 0}
    for kw, category in tagged_unique:
        kw_lower = kw.lower()
        if not kw_lower:
            continue
        start = 0
        matched_this_keyword = False
        while True:
            idx = transcript_lower.find(kw_lower, start)
            if idx == -1:
                break
            span = range(idx, idx + len(kw_lower))
            if not any(consumed[i] for i in span):
                for i in span:
                    consumed[i] = True
                matched_this_keyword = True
            start = idx + 1
        if matched_this_keyword:
            counts[category] += 1

    return counts["confirm"], counts["deny"], counts["hedge"]


def _keywords_for(bank: dict[str, list[str]], language_code: str) -> list[str]:
    # Falls back to en-IN's bank for an unrecognized code rather than raising - the architecture
    # claim (Principle 7) is that Sarvam's full catalog is supported, so this stays permissive
    # for languages beyond the three demo ones instead of hard-failing on them.
    return bank.get(language_code, bank["en-IN"])


def parse(transcript: str | None, language_code: str) -> dict:
    """Classify one call transcript into a verification outcome.

    Returns {"outcome": str, "confidence": float | None, "handled_by": "rules"}.
    """
    if transcript is None or not transcript.strip():
        return {"outcome": "no_response", "confidence": None, "handled_by": "rules"}

    lowered = re.sub(r"\s+", " ", transcript.strip().lower())

    confirm_hits, deny_hits, hedge_hits = _count_all_hits(
        lowered,
        _keywords_for(_CONFIRM_KEYWORDS, language_code),
        _keywords_for(_DENY_KEYWORDS, language_code),
        _keywords_for(_HEDGE_KEYWORDS, language_code),
    )

    # Both signals present, or hedging language at least as strong as whatever confirm/deny
    # signal is there - rules genuinely can't safely pick a side (Principle 4).
    # Force-guessing here would be exactly the kind of fabricated confidence Principle 5 forbids.
    if confirm_hits > 0 and deny_hits > 0:
        return {"outcome": "unclear", "confidence": 0.3, "handled_by": "rules"}
    if hedge_hits > 0 and hedge_hits >= max(confirm_hits, deny_hits):
        return {"outcome": "unclear", "confidence": 0.3, "handled_by": "rules"}
    if confirm_hits == 0 and deny_hits == 0:
        return {"outcome": "unclear", "confidence": None, "handled_by": "rules"}

    if confirm_hits > deny_hits:
        confidence = min(0.95, 0.65 + 0.1 * confirm_hits)
        return {"outcome": "confirmed_linked", "confidence": confidence, "handled_by": "rules"}

    confidence = min(0.95, 0.65 + 0.1 * deny_hits)
    return {"outcome": "denied_linked", "confidence": confidence, "handled_by": "rules"}
