"use client"

import {
  RiCustomerService2Line,
  RiHeadphoneLine,
  RiLoader4Line,
  RiMicLine,
  RiPauseLine,
  RiPlayLine,
  RiStopCircleLine,
} from "@remixicon/react"
import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"
import { cn } from "@/lib/utils"

const LANGUAGES = [
  { code: "en-IN" as const, lang: "English", label: "English (India)" },
  { code: "hi-IN" as const, lang: "Hindi", label: "हिन्दी (Hindi)" },
  { code: "mr-IN" as const, lang: "Marathi", label: "मराठी (Marathi)" },
]

type Lang = (typeof LANGUAGES)[number]["code"]
type Role = "merchant" | "customer"

function encodeWav(samples: Float32Array, sampleRate: number): string {
  const n = samples.length
  const buffer = new ArrayBuffer(44 + n * 2)
  const view = new DataView(buffer)
  const write = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  write(0, "RIFF")
  view.setUint32(4, 36 + n * 2, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, "data")
  view.setUint32(40, n * 2, true)
  let offset = 44
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }
  const bytes = new Uint8Array(buffer)
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function playBase64Wav(
  audioBase64: string,
  mimeType: string,
  onEnded: () => void,
): HTMLAudioElement {
  const src = `data:${mimeType};base64,${audioBase64}`
  const audio = new Audio(src)
  audio.onended = onEnded
  audio.onerror = onEnded
  void audio.play()
  return audio
}

export function VoiceStudio() {
  const [language, setLanguage] = useState<Lang>("hi-IN")
  const [role, setRole] = useState<Role>("merchant")
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<"idle" | "speak" | "listen" | "playing">("idle")
  const [agentText, setAgentText] = useState<string>("")
  const [transcript, setTranscript] = useState<string>("")
  const [outcome, setOutcome] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recorderRef = useRef<{ stop: () => Promise<string> } | null>(null)

  const langMeta = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]!

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await unwrap(apiClient.voice.$get())
      if (err) {
        setConfigured(false)
        return
      }
      setConfigured(Boolean((data as { configured?: boolean } | null)?.configured))
    })()
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  function stopAudio() {
    audioRef.current?.pause()
    audioRef.current = null
  }

  async function speak(turn: "opening" | "closing", nextOutcome?: string) {
    setError(null)
    stopAudio()
    setBusy("speak")
    const { data, error: err } = await unwrap(
      apiClient.voice.speak.$post({
        json: { language, role, turn, outcome: nextOutcome },
      }),
    )
    if (err) {
      setBusy("idle")
      setError(err.message)
      return
    }
    const payload = data as { audioBase64: string; mimeType: string; text: string }
    setAgentText(payload.text)
    setBusy("playing")
    audioRef.current = playBase64Wav(payload.audioBase64, payload.mimeType, () => setBusy("idle"))
  }

  async function startRecording() {
    setError(null)
    setTranscript("")
    setOutcome("")
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const ctx = new AudioContext({ sampleRate: 16000 })
    const sampleRate = ctx.sampleRate || 16000
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    const mute = ctx.createGain()
    mute.gain.value = 0
    const chunks: Float32Array[] = []
    processor.onaudioprocess = (event) => {
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(mute)
    mute.connect(ctx.destination)
    recorderRef.current = {
      stop: async () => {
        processor.disconnect()
        source.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        await ctx.close()
        const length = chunks.reduce((n, c) => n + c.length, 0)
        const samples = new Float32Array(length)
        let o = 0
        for (const c of chunks) {
          samples.set(c, o)
          o += c.length
        }
        return encodeWav(samples, sampleRate)
      },
    }
    setRecording(true)
  }

  async function stopRecording() {
    const rec = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    if (!rec) return
    setBusy("listen")
    try {
      const audioBase64 = await rec.stop()
      const { data, error: err } = await unwrap(
        apiClient.voice.listen.$post({
          json: { language, role, audioBase64, mimeType: "audio/wav" },
        }),
      )
      if (err) {
        setBusy("idle")
        setError(err.message)
        return
      }
      const payload = data as {
        audioBase64: string
        mimeType: string
        text: string
        outcome?: string
        transcript?: string
      }
      setTranscript(payload.transcript ?? "")
      setOutcome(payload.outcome ?? "")
      setAgentText(payload.text)
      setBusy("playing")
      audioRef.current = playBase64Wav(payload.audioBase64, payload.mimeType, () => setBusy("idle"))
    } catch (e) {
      setBusy("idle")
      setError(e instanceof Error ? e.message : "Microphone failed")
    }
  }

  const blocked = configured === false

  return (
    <div className="glass-panel-elevated relative overflow-hidden rounded-2xl border p-6 shadow-xl">
      <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-25" />

      <div className="border-border/70 relative z-10 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 shadow-sm">
            <RiHeadphoneLine className="size-5" />
          </div>
          <div>
            <h3 className="text-foreground text-base font-bold">Sarvam voice agent</h3>
            <p className="text-muted-foreground text-xs">
              Live Bulbul v3 speech in English, Hindi, and Marathi. Asks. Does not cancel on its
              own.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="border-border/80 bg-background/80 flex items-center gap-1 rounded-lg border p-1">
            {(["merchant", "customer"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRole(r)
                  setOutcome("")
                  setTranscript("")
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold capitalize",
                  role === r
                    ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r === "merchant" ? "Call merchant" : "Verify customer"}
              </button>
            ))}
          </div>
          <div className="border-border/80 bg-background/80 flex items-center gap-1.5 rounded-lg border p-1">
            {LANGUAGES.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => {
                  setLanguage(s.code)
                  stopAudio()
                  setBusy("idle")
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  language === s.code
                    ? "bg-purple-500/15 text-purple-600 dark:text-purple-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.lang}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-border/80 bg-background/60 relative z-10 mt-5 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="icon"
            disabled={blocked || busy === "speak" || busy === "listen" || recording}
            onClick={() => {
              if (busy === "playing") {
                stopAudio()
                setBusy("idle")
                return
              }
              void speak("opening")
            }}
            className="size-10 rounded-xl bg-purple-600 text-white shadow-lg shadow-purple-500/30"
          >
            {busy === "speak" ? (
              <RiLoader4Line className="size-5 animate-spin" />
            ) : busy === "playing" ? (
              <RiPauseLine className="size-5" />
            ) : (
              <RiPlayLine className="ml-0.5 size-5" />
            )}
          </Button>
          <Button
            size="sm"
            variant={recording ? "destructive" : "outline"}
            disabled={blocked || (busy !== "idle" && !recording)}
            onClick={() => void (recording ? stopRecording() : startRecording())}
          >
            {recording ? (
              <RiStopCircleLine className="size-4" />
            ) : busy === "listen" ? (
              <RiLoader4Line className="size-4 animate-spin" />
            ) : (
              <RiMicLine className="size-4" />
            )}
            {recording ? "Stop and answer" : "Speak your reply"}
          </Button>
          <div>
            <div className="text-foreground text-xs font-bold">
              Sarvam Bulbul v3 · {langMeta.label}
            </div>
            <div className="text-muted-foreground text-[11px]">
              {blocked
                ? "API unreachable or SARVAM_API_KEY missing"
                : recording
                  ? "Listening…"
                  : busy === "speak"
                    ? "Synthesizing…"
                    : busy === "playing"
                      ? "Speaking…"
                      : "Play the agent, then answer"}
            </div>
          </div>
          {outcome && (
            <Badge variant="outline" className="ml-auto font-mono text-xs">
              {outcome}
            </Badge>
          )}
        </div>
      </div>

      <div className="relative z-10 mt-5 grid gap-4 lg:grid-cols-2">
        <div className="border-border/80 bg-card/60 space-y-2 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
            <RiCustomerService2Line className="size-4" />
            <span>Agent ({language})</span>
          </div>
          <p className="text-foreground text-sm leading-relaxed">
            {agentText ||
              (role === "merchant"
                ? "Play to hear: this payment looks like fraud. Cancel it, or release the hold?"
                : "Play to hear the customer verification question.")}
          </p>
        </div>
        <div className="border-border/80 bg-card/60 space-y-2 rounded-xl border p-4">
          <div className="text-foreground flex items-center gap-2 text-xs font-semibold">
            <RiMicLine className="size-4 text-emerald-500" />
            <span>Your reply (Sarvam Saaras)</span>
          </div>
          <p className="text-foreground text-sm leading-relaxed">
            {transcript || "After the agent speaks, hold Speak your reply, then stop."}
          </p>
        </div>
      </div>

      {error && <p className="text-destructive relative z-10 mt-3 text-xs">{error}</p>}
      {blocked && (
        <p className="text-muted-foreground relative z-10 mt-3 text-xs">
          Set SARVAM_API_KEY on the API, restart it, and keep the web app pointed at that API. The
          voice studio cannot speak while the API is down.
        </p>
      )}
    </div>
  )
}
