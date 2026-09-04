"""Simulated call harness (Architecture.md §9).

Simulated-call-first: this is the default call path for the whole build, not a fallback - real
Twilio/Exotel (twilio_call.py) is a stretch item gated behind this working end to end first
(Phase 6, "Stretch, priority order").

This module does not run real telephony, TTS, or STT - it never invents a transcript itself
(Principle 5: no fabricated confidence, and a made-up transcript is the same class of
problem). The caller supplies the account holder's simulated response - drawn from
data/synthetic_response_test_set.json for a batch/demo run, or typed by a human running a live
demo - and this function's only job is to shape that into the same {"transcript", "reached"}
contract a real Twilio/Sarvam-backed harness would return, so main.py's /call handler and
response_parser.py never need to know which harness is behind them.
"""

from __future__ import annotations


def place_call(
    account_id: str,
    language_code: str,
    script: str,
    *,
    simulated_transcript: str | None = None,
) -> dict:
    """Places a simulated call and returns {"transcript": str | None, "reached": bool}.

    `account_id`, `language_code`, and `script` are accepted (matching the real harness's
    contract - a real implementation dials `account_id`'s number, speaks `script` via TTS in
    `language_code`) but unused here beyond that; the simulated response comes from
    `simulated_transcript` alone. No answer looks like a real unreached call: `reached=False`
    with no transcript, which response_parser.parse() already treats as `no_response`.
    """
    if simulated_transcript is None:
        return {"transcript": None, "reached": False}
    return {"transcript": simulated_transcript, "reached": True}
