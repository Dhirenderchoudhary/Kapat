"""Thin client for Sarvam AI's STT/TTS APIs (saaras:v3, bulbul:v3 - Architecture.md §2.2).

Not implemented yet - Phase 6 (Phases.md). Blocked on a Sarvam AI account and API key
(Phases.md Phase 0 exit criteria: "Sarvam's actual voice output for Hindi/Marathi is heard and
judged acceptable, or the fallback decision is made"). That account creation and the live
listening test are steps only a human can do - they are not performed by this scaffold.

Expected surface once built: a synthesize(text, language_code) -> audio and a
transcribe(audio, language_code) -> text function, called only from call_harness/*.py, never
directly from response_parser.py or conversation_flow.py.
"""
