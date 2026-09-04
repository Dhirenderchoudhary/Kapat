"""Ring-verification call script (Design.md §3, Architecture.md §2.2).

Script structure is fixed by Design.md §3: identify -> state the finding -> ask -> listen, one
clarifying re-ask maximum if unclear -> close. Sample phrasing for hi-IN/en-IN/mr-IN is in
Design.md §3 - the templates below follow that phrasing, parameterized by which signal_type
was actually found (Principle 9: never a vague "you're linked to another account",
always the specific signal).

This is a ring-linkage question ("are you aware of this other account"), not a
transaction-authorization question - read that distinction before touching this file or
response_parser.py: the outcome meanings are inverted from a single-transaction verifier.

Have a fluent speaker sanity-check the hi-IN/mr-IN phrasing before recording (Design.md §3's own
note) - this is generated script text, not yet reviewed by a native speaker.
"""

from __future__ import annotations

# account_links.signal_type's five real values (packages/db/src/schema/fraud.ts) mapped to the
# short phrase Design.md §3's "[address/payment method]" placeholder stands in for, per language.
_SIGNAL_PHRASES: dict[str, dict[str, str]] = {
    "shared_address": {
        "en-IN": "delivery address",
        "hi-IN": "delivery address",
        "mr-IN": "delivery address",
    },
    "shared_payment": {
        "en-IN": "payment method",
        "hi-IN": "payment method",
        "mr-IN": "payment method",
    },
    "shared_phone_pattern": {
        "en-IN": "phone number pattern",
        "hi-IN": "phone number pattern",
        "mr-IN": "phone number pattern",
    },
    "coordinated_timing": {
        "en-IN": "transaction timing",
        "hi-IN": "transaction timing",
        "mr-IN": "transaction timing",
    },
    "shared_promo": {
        "en-IN": "promo code",
        "hi-IN": "promo code",
        "mr-IN": "promo code",
    },
}

# Design.md §3's sample phrasing (steps 1-3: identify, state the finding, ask), with the shared
# signal substituted in.
_OPENING_TEMPLATES: dict[str, str] = {
    "en-IN": (
        "Hi, this is an automated call from Razorpay. We noticed your account shares the same "
        "{signal} with another account. Are you aware of this other account - is it a family "
        "member or someone you know?"
    ),
    "hi-IN": (
        "Namaste, main Razorpay ki taraf se baat kar raha hoon. Humne dekha ki aapka account ek "
        "doosre account ke saath same {signal} share karta hai. Kya aap is doosre account ke "
        "baare mein jaante hain - kya yeh aapke parivar ka koi sadasya hai?"
    ),
    "mr-IN": (
        "Namaskar, hi Razorpay kadun call ahe. Tumcha account ek dusrya account sobat {signal} "
        "share karto ase amhala disla. Tumhala ha dusra account mahit ahe ka - to tumcha "
        "kutumbiya ahe ka?"
    ),
}

_CLARIFYING_REASK: dict[str, str] = {
    "en-IN": "Sorry, just to confirm clearly - do you recognize this other account, yes or no?",
    "hi-IN": "Maaf kijiye, saaf tarah se confirm karne ke liye - kya aap is doosre account ko pehchaante hain, haan ya nahi?",
    "mr-IN": "Maaf kara, spashtapane samajun ghenyasathi - tumhi ha dusra account olakhta ka, hoy ki nahi?",
}

# Step 5 - close: tell them what happens next, worded per outcome so the closing line never
# implies the wrong thing regardless of what was actually said (saying
# something generic here risks the same inversion bug this whole module is designed to avoid).
_CLOSING_LINES: dict[str, dict[str, str]] = {
    "en-IN": {
        "confirmed_linked": "Thanks for confirming - since this looks like a known connection, no action is needed on your account right now.",
        "denied_linked": "Thanks for letting us know. Since you don't recognize this account, we'll flag this for our team to review further.",
        "unclear": "Thanks for your time - we weren't able to get a clear answer, so this will be reviewed by our team along with the other evidence we have.",
        "no_response": "We were unable to reach you this time. Your account remains under review based on the evidence we already have.",
    },
    "hi-IN": {
        "confirmed_linked": "Confirm karne ke liye dhanyavaad - yeh ek jaana-pehchaana connection lagta hai, isliye abhi aapke account par koi action nahi liya jaayega.",
        "denied_linked": "Batane ke liye dhanyavaad. Kyunki aap is account ko nahi pehchaante, hamari team isko aage review karegi.",
        "unclear": "Aapke samay ke liye dhanyavaad - hume saaf jawaab nahi mil paaya, isliye hamari team ise baaki evidence ke saath review karegi.",
        "no_response": "Hum is baar aapse sampark nahi kar paaye. Aapka account pehle se maujood evidence ke aadhar par review mein rahega.",
    },
    "mr-IN": {
        "confirmed_linked": "Confirm kelyabaddal dhanyavad - ha olakhicha connection distoy, tyamule sadhya tumchya account var kahi action ghetla jaanar nahi.",
        "denied_linked": "Kalavlyabaddal dhanyavad. Tumhi ha account olakhat nasalyamule, amchi team hyacha pudhe review karel.",
        "unclear": "Tumchya velesathi dhanyavad - amhala spashta uttar milale nahi, tyamule amchi team itar puravyansobat hyacha review karel.",
        "no_response": "Ya veli amhi tumchyashi sampark karu shakalo nahi. Tumcha account adhichya puravyanchya aadharavar review madhe rahil.",
    },
}


def _language_or_default(language_code: str) -> str:
    return language_code if language_code in _OPENING_TEMPLATES else "en-IN"


def build_opening_script(language_code: str, signal_type: str) -> str:
    """Steps 1-3 (identify, state the finding, ask) - the text a call harness sends to TTS."""
    lang = _language_or_default(language_code)
    phrase_map = _SIGNAL_PHRASES.get(signal_type)
    # Never silently drop an unrecognized signal_type (Principle 9) - fall back to the
    # literal signal_type rather than a vague "something" the account holder can't act on.
    signal_phrase = phrase_map[lang] if phrase_map else signal_type
    return _OPENING_TEMPLATES[lang].format(signal=signal_phrase)


def build_clarifying_reask(language_code: str) -> str:
    """Step 4b - the single permitted clarifying re-ask when the first answer was unclear."""
    lang = _language_or_default(language_code)
    return _CLARIFYING_REASK[lang]


def build_closing_line(language_code: str, outcome: str) -> str:
    """Step 5 - close: tell the account holder what happens next, worded for the real outcome."""
    lang = _language_or_default(language_code)
    lines = _CLOSING_LINES[lang]
    return lines.get(outcome, lines["unclear"])
