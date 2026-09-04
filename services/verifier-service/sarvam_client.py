"""Sarvam AI STT/TTS (saaras:v3, bulbul:v3).

Called only from call_harness/*.py. Needs SARVAM_API_KEY in the environment. The dashboard
voice studio talks to the same vendor through the Hono API (POST /api/voice), not this module.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

TTS_URL = "https://api.sarvam.ai/text-to-speech"
STT_URL = "https://api.sarvam.ai/speech-to-text"


class SarvamError(RuntimeError):
    pass


def _key() -> str:
    key = os.environ.get("SARVAM_API_KEY", "").strip()
    if not key:
        raise SarvamError("SARVAM_API_KEY is not set")
    return key


def synthesize(text: str, language_code: str) -> bytes:
    """Return WAV bytes for `text` in `language_code` (en-IN, hi-IN, mr-IN)."""
    payload = json.dumps(
        {
            "text": text,
            "model": "bulbul:v3",
            "speaker": "shubh",
            "language_code": language_code,
            "pace": 0.95,
        }
    ).encode()
    req = urllib.request.Request(
        TTS_URL,
        data=payload,
        headers={
            "api-subscription-key": _key(),
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.loads(res.read().decode())
    except urllib.error.HTTPError as err:
        raise SarvamError(f"Sarvam TTS HTTP {err.code}") from err
    audios = body.get("audios") or []
    if not audios:
        raise SarvamError("Sarvam TTS returned no audio")
    import base64

    return base64.b64decode(audios[0])
