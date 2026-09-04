export const VOICE_LANGUAGES = ["en-IN", "hi-IN", "mr-IN"] as const
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]

export const VOICE_ROLES = ["merchant", "customer"] as const
export type VoiceRole = (typeof VOICE_ROLES)[number]

export const VOICE_TURNS = ["opening", "closing"] as const
export type VoiceTurn = (typeof VOICE_TURNS)[number]

export const MERCHANT_DECISIONS = ["cancel", "release", "unclear"] as const
export type MerchantDecision = (typeof MERCHANT_DECISIONS)[number]

export const CUSTOMER_OUTCOMES = ["confirmed_linked", "denied_linked", "unclear"] as const
export type CustomerOutcome = (typeof CUSTOMER_OUTCOMES)[number]

type ScriptPack = {
  opening: string
  closing: Record<MerchantDecision, string> | Record<CustomerOutcome, string>
}

// Native script for Indic lines: romanized input degrades Bulbul quality.
const MERCHANT: Record<
  VoiceLanguage,
  { opening: string; closing: Record<MerchantDecision, string> }
> = {
  "en-IN": {
    opening:
      "Hello, this is Razorpay Risk Manager. We held a payment because it looks like coordinated fraud, not a normal transaction. Should we cancel this payment, or release the hold?",
    closing: {
      cancel:
        "Understood. We will keep the hold and cancel settlement. The customer is not charged. A merchant still has to confirm this in the dashboard.",
      release: "Understood. We will release the hold so the payment can be captured. Thank you.",
      unclear:
        "I did not catch a clear yes or no. Please say cancel the payment, or release the hold.",
    },
  },
  "hi-IN": {
    opening:
      "नमस्ते, मैं Razorpay रिस्क मैनेजर से बात कर रहा हूँ। हमने एक पेमेंट होल्ड किया है क्योंकि यह समन्वित फ्रॉड लगता है, साधारण लेनदेन नहीं। क्या हम यह पेमेंट रद्द कर दें, या होल्ड हटा दें?",
    closing: {
      cancel:
        "समझ गया। हम होल्ड रखेंगे और सेटलमेंट रद्द करेंगे। ग्राहक से पैसे नहीं कटेंगे। डैशबोर्ड पर मर्चेंट की पुष्टि अभी भी चाहिए।",
      release: "समझ गया। हम होल्ड हटा देंगे ताकि पेमेंट कैप्चर हो सके। धन्यवाद।",
      unclear: "साफ़ जवाब नहीं मिला। कृपया कहें पेमेंट रद्द करें, या होल्ड हटा दें।",
    },
  },
  "mr-IN": {
    opening:
      "नमस्कार, हा Razorpay रिस्क मॅनेजर कडून कॉल आहे. आम्ही एक पेमेंट होल्ड केले आहे कारण हे समन्वित फसवणूक दिसते, नेहमीचे व्यवहार नाही. हे पेमेंट रद्द करायचे का, की होल्ड काढायचे?",
    closing: {
      cancel:
        "समजले. आम्ही होल्ड ठेवू आणि सेटलमेंट रद्द करू. ग्राहकाकडून पैसे कपात होणार नाहीत. डॅशबोर्डवर मर्चंटची पुष्टी अजून हवी.",
      release: "समजले. आम्ही होल्ड काढू जेणेकरून पेमेंट कॅप्चर होईल. धन्यवाद.",
      unclear: "स्पष्ट उत्तर मिळाले नाही. कृपया सांगा पेमेंट रद्द करा, किंवा होल्ड काढा.",
    },
  },
}

const CUSTOMER: Record<
  VoiceLanguage,
  { opening: string; closing: Record<CustomerOutcome, string> }
> = {
  "en-IN": {
    opening:
      "Hi, this is an automated call from Razorpay. We noticed your account shares the same payment method with another account. Are you aware of this other account, is it family or someone you know?",
    closing: {
      confirmed_linked:
        "Thanks for confirming. This looks like a known connection, so no action is needed on your account right now.",
      denied_linked:
        "Thanks for letting us know. Since you do not recognize this account, our team will review it further.",
      unclear:
        "Thanks for your time. We did not get a clear answer, so this will be reviewed with the other evidence.",
    },
  },
  "hi-IN": {
    opening:
      "नमस्ते, मैं Razorpay की तरफ़ से बात कर रहा हूँ। हमने देखा कि आपका अकाउंट एक दूसरे अकाउंट के साथ वही पेमेंट मेथड शेयर करता है। क्या आप इस दूसरे अकाउंट को जानते हैं, क्या यह परिवार का है?",
    closing: {
      confirmed_linked:
        "पुष्टि के लिए धन्यवाद। यह जाना-पहचाना कनेक्शन लगता है, इसलिए अभी आपके अकाउंट पर कोई कार्रवाई नहीं होगी।",
      denied_linked:
        "बताने के लिए धन्यवाद। आप इस अकाउंट को नहीं पहचानते, इसलिए हमारी टीम आगे समीक्षा करेगी।",
      unclear: "समय के लिए धन्यवाद। साफ़ जवाब नहीं मिला, इसलिए बाकी सबूतों के साथ समीक्षा होगी।",
    },
  },
  "mr-IN": {
    opening:
      "नमस्कार, हा Razorpay कडून कॉल आहे. तुमचे अकाउंट दुसऱ्या अकाउंटसोबत तोच पेमेंट मेथड शेअर करते असे आम्हाला दिसले. तुम्हाला हे दुसरे अकाउंट माहीत आहे का, ते कुटुंबीय आहे का?",
    closing: {
      confirmed_linked:
        "पुष्टी केल्याबद्दल धन्यवाद. हा ओळखीचा कनेक्शन दिसतो, त्यामुळे सध्या तुमच्या अकाउंटवर काही कारवाई नाही.",
      denied_linked: "सांगितल्याबद्दल धन्यवाद. तुम्ही हे अकाउंट ओळखत नसल्यामुळे आमची टीम पुढे तपास करेल.",
      unclear: "वेळेसाठी धन्यवाद. स्पष्ट उत्तर मिळाले नाही, त्यामुळे इतर पुराव्यांसोबत तपास होईल.",
    },
  },
}

export function scriptFor(
  role: VoiceRole,
  language: VoiceLanguage,
  turn: VoiceTurn,
  outcome?: string,
): string {
  const pack: ScriptPack = role === "merchant" ? MERCHANT[language] : CUSTOMER[language]
  if (turn === "opening") return pack.opening
  if (role === "merchant") {
    const key = (["cancel", "release", "unclear"] as const).includes(outcome as MerchantDecision)
      ? (outcome as MerchantDecision)
      : "unclear"
    return MERCHANT[language].closing[key]
  }
  const key = (["confirmed_linked", "denied_linked", "unclear"] as const).includes(
    outcome as CustomerOutcome,
  )
    ? (outcome as CustomerOutcome)
    : "unclear"
  return CUSTOMER[language].closing[key]
}

const CANCEL_HINTS = [
  "cancel",
  "cancelled",
  "radd",
  "raddd",
  "रद्द",
  "रद्द करा",
  "रद्द कर",
  "haan cancel",
  "yes cancel",
  "cancel it",
  "cancel the payment",
  "होल्ड रख",
]
const RELEASE_HINTS = [
  "release",
  "released",
  "capture",
  "chhod",
  "chhodo",
  "छोड़",
  "हटा",
  "काढ",
  "soda",
  "सोडा",
  "no cancel",
  "don't cancel",
  "do not cancel",
  "mat radd",
  "नको रद्द",
  "release the hold",
]

function includesAny(text: string, hints: string[]): boolean {
  return hints.some((h) => text.includes(h))
}

export function parseMerchantReply(transcript: string): MerchantDecision {
  const t = transcript.trim().toLowerCase()
  if (!t) return "unclear"
  const cancel = includesAny(t, CANCEL_HINTS)
  const release = includesAny(t, RELEASE_HINTS)
  if (cancel && !release) return "cancel"
  if (release && !cancel) return "release"
  if (cancel && release) return "unclear"
  if (/^\s*(yes|haan|ha[aā]n|होय|हां|हाँ)\b/.test(t)) return "cancel"
  if (/^\s*(no|nahi|nah[iī]|नाही|नहीं)\b/.test(t)) return "release"
  return "unclear"
}

const CONFIRM_HINTS = [
  "yes",
  "yeah",
  "haan",
  "hoy",
  "होय",
  "हां",
  "हाँ",
  "brother",
  "family",
  "bhai",
  "parivar",
  "kutumb",
  "भाई",
  "परिवार",
  "कुटुंब",
  "my brother's",
  "roommate",
]
const DENY_HINTS = [
  "no idea",
  "don't know",
  "do not know",
  "nahi jaanta",
  "nahi janta",
  "not aware",
  "don't recognize",
  "no i have no",
  "नहीं जानता",
  "माहित नाही",
  "olakhata nahi",
]

export function parseCustomerReply(transcript: string): CustomerOutcome {
  const t = transcript.trim().toLowerCase()
  if (!t) return "unclear"
  const yes = includesAny(t, CONFIRM_HINTS)
  const no = includesAny(t, DENY_HINTS) || (/\bno\b/.test(t) && !yes)
  if (yes && !no) return "confirmed_linked"
  if (no && !yes) return "denied_linked"
  return "unclear"
}

export function parseReply(role: VoiceRole, transcript: string): string {
  return role === "merchant" ? parseMerchantReply(transcript) : parseCustomerReply(transcript)
}
