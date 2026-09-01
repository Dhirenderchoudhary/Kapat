"""FastAPI entrypoint for services/verifier-service.

Contract (Architecture.md §6): POST /call is the single deep-module boundary this service
exposes - triggers voice verification for one borderline account within a cluster. Sarvam AI
integration, conversation scripting, and response parsing (sarvam_client.py,
conversation_flow.py, response_parser.py) are implementation details behind that one contract.

Phase 6 status: genuinely wired - conversation_flow.build_opening_script() ->
call_harness.simulated_call.place_call() -> response_parser.parse() is the real pipeline
(Architecture.md §2.2), the same three-step chain Design.md §3 specifies, with the one permitted
clarifying re-ask (Design.md §3 step 4) actually implemented, not just documented.

This is still the *simulated* call harness (Architecture.md §9 - simulated-call-first is the
default path, not a fallback): there's no live telephony or Sarvam STT/TTS behind it yet, so the
caller supplies the account holder's simulated response transcript directly
(`simulated_transcript` / `simulated_reask_transcript`). Omitting one is a legitimate way to
simulate an unanswered call (Flow D, PRD.md §7) - it is not an error, and this endpoint never
invents a transcript to paper over that (Rules.md Principle 5).
"""

from fastapi import FastAPI
from pydantic import BaseModel

import conversation_flow
import response_parser
from call_harness import simulated_call

app = FastAPI(title="verifier-service", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "verifier-service"}


class CallRequest(BaseModel):
    cluster_id: str
    account_id: str
    language_code: str  # hi-IN | en-IN | mr-IN for the live demo (Rules.md Principle 7)
    signal_type: str  # which account_links signal_type triggered this call (Rules.md Principle 9)
    # Simulated-call-first (Architecture.md §9): the caller supplies what the account holder
    # said, since this harness doesn't run real telephony/STT. None simulates "call not
    # answered" for the initial attempt / the clarifying re-ask respectively.
    simulated_transcript: str | None = None
    simulated_reask_transcript: str | None = None


class CallResponse(BaseModel):
    outcome: str  # confirmed_linked | denied_linked | unclear | no_response
    transcript: str | None = None
    confidence: float | None = None
    handled_by: str | None = None  # "rules" - Rules.md Principle 4: log which path handled it
    opening_script: str
    closing_line: str


@app.post("/call", response_model=CallResponse)
def call(request: CallRequest) -> CallResponse:
    opening_script = conversation_flow.build_opening_script(request.language_code, request.signal_type)

    call_result = simulated_call.place_call(
        request.account_id,
        request.language_code,
        opening_script,
        simulated_transcript=request.simulated_transcript,
    )
    parsed = response_parser.parse(call_result["transcript"], request.language_code)

    # Design.md §3 step 4: "listen, one clarifying re-ask maximum if unclear" - only re-ask if
    # the call was actually reached (re-asking an unanswered call makes no sense) and the first
    # answer came back genuinely ambiguous.
    if parsed["outcome"] == "unclear" and call_result["reached"]:
        reask_script = conversation_flow.build_clarifying_reask(request.language_code)
        reask_result = simulated_call.place_call(
            request.account_id,
            request.language_code,
            reask_script,
            simulated_transcript=request.simulated_reask_transcript,
        )
        if reask_result["reached"]:
            call_result = reask_result
            parsed = response_parser.parse(reask_result["transcript"], request.language_code)

    closing_line = conversation_flow.build_closing_line(request.language_code, parsed["outcome"])

    return CallResponse(
        outcome=parsed["outcome"],
        transcript=call_result["transcript"],
        confidence=parsed["confidence"],
        handled_by=parsed["handled_by"],
        opening_script=opening_script,
        closing_line=closing_line,
    )
