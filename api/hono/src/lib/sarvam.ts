import { ApiError } from "@/lib/error"

const SARVAM_TTS = "https://api.sarvam.ai/text-to-speech"
const SARVAM_STT = "https://api.sarvam.ai/speech-to-text"

export function sarvamKey(): string | null {
  const key = process.env.SARVAM_API_KEY?.trim()
  return key ? key : null
}

type TtsResponse = {
  audios?: string[]
  request_id?: string
  error?: { message?: string } | string
  message?: string
}

export async function synthesizeSpeech(text: string, languageCode: string): Promise<string> {
  const key = sarvamKey()
  if (!key) {
    throw new ApiError(
      503,
      "VOICE_NOT_CONFIGURED",
      "SARVAM_API_KEY is not set. Add it on the API server and restart.",
    )
  }

  const body = {
    text,
    model: "bulbul:v3",
    speaker: "shubh",
    language_code: languageCode,
    pace: 0.95,
  }

  let res = await fetch(SARVAM_TTS, {
    method: "POST",
    headers: {
      "api-subscription-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  // Older REST field name. Retry once if this deployment still expects it.
  if (res.status === 400 || res.status === 422) {
    const { language_code: _language, ...rest } = body
    res = await fetch(SARVAM_TTS, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...rest, target_language_code: languageCode }),
    })
  }

  const payload = (await res.json().catch(() => null)) as TtsResponse | null
  if (!res.ok || !payload?.audios?.[0]) {
    const detail =
      (typeof payload?.error === "string" ? payload.error : payload?.error?.message) ||
      payload?.message ||
      `Sarvam TTS HTTP ${res.status}`
    throw new ApiError(502, "VOICE_FAILED", detail)
  }
  return payload.audios[0]
}

export async function transcribeSpeech(
  audioBase64: string,
  mimeType: string,
  languageCode: string,
): Promise<string> {
  const key = sarvamKey()
  if (!key) {
    throw new ApiError(
      503,
      "VOICE_NOT_CONFIGURED",
      "SARVAM_API_KEY is not set. Add it on the API server and restart.",
    )
  }

  const bytes = Buffer.from(audioBase64, "base64")
  const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : "wav"
  const form = new FormData()
  form.append("file", new Blob([bytes], { type: mimeType || "audio/wav" }), `reply.${ext}`)
  form.set("model", "saaras:v3")
  form.set("mode", "codemix")
  form.set("language_code", languageCode)

  const res = await fetch(SARVAM_STT, {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
  })
  const payload = (await res.json().catch(() => null)) as {
    transcript?: string
    error?: { message?: string } | string
    message?: string
  } | null
  if (!res.ok || typeof payload?.transcript !== "string") {
    const detail =
      (typeof payload?.error === "string" ? payload.error : payload?.error?.message) ||
      payload?.message ||
      `Sarvam STT HTTP ${res.status}`
    throw new ApiError(502, "VOICE_FAILED", detail)
  }
  return payload.transcript
}
