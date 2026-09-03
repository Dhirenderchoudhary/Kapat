"use client"

import {
  RiCustomerService2Line,
  RiHeadphoneLine,
  RiPauseLine,
  RiPlayLine,
  RiVolumeUpLine,
} from "@remixicon/react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface VoiceSample {
  lang: string
  code: string
  label: string
  speaker: string
  question: string
  answer: string
  outcome: "confirmed_linked" | "denied_linked"
  outcomeLabel: string
  suspicionImpact: string
}

const SAMPLES: VoiceSample[] = [
  {
    lang: "Hindi",
    code: "hi-IN",
    label: "हिन्दी (Hindi)",
    speaker: "Sarvam Bulbul v2",
    question:
      "Namaste, main Razorpay ki taraf se baat kar raha hoon. Humne dekha ki aapka account ek doosre account ke saath same address share karta hai. Kya aap is doosre account ke baare mein jaante hain?",
    answer: "Nahi, main kisi doosre account ko nahi jaanta. Ye mera akela account hai.",
    outcome: "denied_linked",
    outcomeLabel: "Denied Knowledge (Ring Strengthened)",
    suspicionImpact: "Risk +0.40 • Syndicate Hypothesis Confirmed",
  },
  {
    lang: "English (India)",
    code: "en-IN",
    label: "English (India)",
    speaker: "Sarvam Bulbul v2",
    question:
      "Hi, this is an automated call from Razorpay. We noticed your account shares the same payment method with another account. Are you aware of this other account?",
    answer: "Yes, that is my brother's account, we live in the same house and share the card.",
    outcome: "confirmed_linked",
    outcomeLabel: "Confirmed Family Link (Benign)",
    suspicionImpact: "Risk Capped • Whitelisted Household",
  },
  {
    lang: "Marathi",
    code: "mr-IN",
    label: "मराठी (Marathi)",
    speaker: "Sarvam Bulbul v2",
    question:
      "Namaskar, hi Razorpay kadun call ahe. Tumcha account ek dusrya account sobat payment method share karto ase amhala disla. Tumhala ha dusra account mahit ahe ka?",
    answer: "Ho, te majhya mitrache account ahe, aamhi sobat rahto.",
    outcome: "confirmed_linked",
    outcomeLabel: "Confirmed Roommate Link",
    suspicionImpact: "Legitimate Cohabitation • Hold Released",
  },
]

export function VoiceStudio() {
  const [selectedLang, setSelectedLang] = useState<string>("hi-IN")
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackProgress, setPlaybackProgress] = useState(0)

  const sample = SAMPLES.find((s) => s.code === selectedLang) ?? SAMPLES[0]!

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (isPlaying) {
      timer = setInterval(() => {
        setPlaybackProgress((prev) => {
          if (prev >= 100) {
            setIsPlaying(false)
            return 0
          }
          return prev + 4
        })
      }, 150)
    } else {
      setPlaybackProgress(0)
    }
    return () => clearInterval(timer)
  }, [isPlaying])

  return (
    <div className="glass-panel-elevated relative overflow-hidden rounded-2xl border p-6 shadow-xl">
      <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-25" />

      {/* Header */}
      <div className="border-border/70 relative z-10 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500 shadow-sm">
            <RiHeadphoneLine className="size-5" />
          </div>
          <div>
            <h3 className="text-foreground text-base font-bold">Voice AI Verification Studio</h3>
            <p className="text-muted-foreground text-xs">
              Autonomous multi-lingual phone verification powered by Sarvam AI (en-IN, hi-IN, mr-IN)
            </p>
          </div>
        </div>

        {/* Language Tabs */}
        <div className="border-border/80 bg-background/80 flex items-center gap-1.5 rounded-lg border p-1 backdrop-blur-md">
          {SAMPLES.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => {
                setSelectedLang(s.code)
                setIsPlaying(false)
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-semibold transition-all",
                selectedLang === s.code
                  ? "bg-purple-500/15 text-purple-600 shadow-xs dark:text-purple-400"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.lang}
            </button>
          ))}
        </div>
      </div>

      {/* Audio Waveform Player */}
      <div className="border-border/80 bg-background/60 relative z-10 mt-5 rounded-xl border p-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              size="icon"
              onClick={() => setIsPlaying((p) => !p)}
              className={cn(
                "size-10 rounded-xl transition-all",
                isPlaying
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/30"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {isPlaying ? (
                <RiPauseLine className="size-5" />
              ) : (
                <RiPlayLine className="ml-0.5 size-5" />
              )}
            </Button>
            <div>
              <div className="text-foreground text-xs font-bold">{sample.speaker}</div>
              <div className="text-muted-foreground text-[11px]">
                {isPlaying ? "Simulated Live Streaming Audio..." : "Click to play simulated call"}
              </div>
            </div>
          </div>

          {/* Animated Waveform Equalizer Bars */}
          <div className="flex h-8 items-center gap-1 px-4">
            {[40, 70, 30, 90, 60, 100, 45, 80, 55, 95, 35, 75, 50, 85, 65, 30, 70].map(
              (height, idx) => (
                <span
                  key={idx}
                  className={cn(
                    "w-1 rounded-full transition-all duration-150",
                    isPlaying ? "bg-purple-500" : "bg-muted-foreground/30",
                  )}
                  style={{
                    height: isPlaying
                      ? `${Math.max(12, (height * (Math.sin((playbackProgress + idx * 8) * 0.2) + 1.2)) / 2)}%`
                      : "20%",
                  }}
                />
              ),
            )}
          </div>

          <Badge
            variant="outline"
            className={cn(
              "font-mono text-xs",
              sample.outcome === "denied_linked"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            )}
          >
            {sample.outcomeLabel}
          </Badge>
        </div>

        {/* Live Progress Bar */}
        <div className="bg-muted mt-3 h-1 w-full overflow-hidden rounded-full">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-150"
            style={{ width: `${playbackProgress}%` }}
          />
        </div>
      </div>

      {/* Transcript Dialogue */}
      <div className="relative z-10 mt-5 grid gap-4 lg:grid-cols-2">
        <div className="border-border/80 bg-card/60 space-y-2 rounded-xl border p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
            <RiCustomerService2Line className="size-4" />
            <span>AI Risk Agent Prompt ({sample.code})</span>
          </div>
          <p className="text-foreground font-mono text-xs leading-relaxed italic">
            &ldquo;{sample.question}&rdquo;
          </p>
        </div>

        <div className="border-border/80 bg-card/60 space-y-2 rounded-xl border p-4">
          <div className="text-foreground flex items-center gap-2 text-xs font-semibold">
            <RiVolumeUpLine className="size-4 text-emerald-500" />
            <span>Customer Response &amp; Parser Outcome</span>
          </div>
          <p className="text-foreground font-mono text-xs leading-relaxed">
            &ldquo;{sample.answer}&rdquo;
          </p>
          <div className="text-muted-foreground mt-2 text-[11px] font-semibold">
            Impact: <span className="text-foreground font-bold">{sample.suspicionImpact}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
