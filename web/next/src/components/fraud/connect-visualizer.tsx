"use client"

import {
  RiCheckDoubleLine,
  RiCpuLine,
  RiDatabase2Line,
  RiGitBranchLine,
  RiLockLine,
  RiShieldCheckLine,
  RiUserVoiceLine,
} from "@remixicon/react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function ConnectVisualizer() {
  const [activeLayer, setActiveLayer] = useState<number>(1)

  const LAYERS = [
    {
      id: 1,
      title: "Razorpay Webhook",
      sub: "payment.authorized & payment.captured",
      icon: RiLockLine,
      details:
        "Read-only payload stream authenticated with HMAC SHA256 webhook secrets. Never asks for refunds or payout privileges.",
      badge: "Cryptographically Verified",
    },
    {
      id: 2,
      title: "Graph Engine Worker",
      sub: "Louvain Community Detection",
      icon: RiCpuLine,
      details:
        "Transforms raw transaction parameters into account-to-account linkage graphs. Evaluates SIM sequentiality, device hashes, and velocity.",
      badge: "O(V+E) Realtime",
    },
    {
      id: 3,
      title: "Corroboration Gate",
      sub: "Family & Roommate Filter",
      icon: RiShieldCheckLine,
      details:
        "Caps innocent cohabiting households below the 0.45 hold threshold, eliminating up to 90% of traditional fraud false-alarms.",
      badge: "0 False Positives",
    },
    {
      id: 4,
      title: "Sarvam AI Voice Agent",
      sub: "Hindi, English & Marathi calls",
      icon: RiUserVoiceLine,
      details:
        "Autonomous phone verification resolves ambiguous cases directly with account holders before taking permanent action.",
      badge: "3 Indian Languages",
    },
    {
      id: 5,
      title: "Merchant Safe Escrow",
      sub: "3-Day Auto Expiry Protection",
      icon: RiDatabase2Line,
      details:
        "Flagged transactions are held for operator review without cancellation. Zero unexpected customer friction.",
      badge: "Human In The Loop",
    },
  ]

  const current = LAYERS.find((l) => l.id === activeLayer) ?? LAYERS[0]!

  return (
    <div className="glass-panel-elevated relative overflow-hidden rounded-2xl border p-6 shadow-2xl">
      <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-25" />

      <div className="border-border/80 relative z-10 flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-2">
          <RiGitBranchLine className="size-5 text-emerald-500" />
          <h3 className="text-foreground font-bold">End-to-End System Architecture</h3>
        </div>
        <Badge
          variant="outline"
          className="font-mono text-xs text-emerald-600 dark:text-emerald-400"
        >
          Zero-Drift Pipeline
        </Badge>
      </div>

      {/* Interactive Moving SVG Node Flow */}
      <div className="relative z-10 my-6">
        <div className="grid gap-3 sm:grid-cols-5">
          {LAYERS.map((layer) => {
            const isActive = layer.id === activeLayer
            const Icon = layer.icon
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => setActiveLayer(layer.id)}
                className={cn(
                  "flex flex-col items-center rounded-xl border p-3.5 text-center transition-all",
                  isActive
                    ? "border-emerald-500/80 bg-emerald-500/10 shadow-lg scale-105"
                    : "border-border/70 bg-card/60 hover:border-emerald-500/40 hover:bg-card/90",
                )}
              >
                <div
                  className={cn(
                    "flex size-10 items-center justify-center rounded-xl transition-colors",
                    isActive
                      ? "bg-emerald-500 text-white shadow-md"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                </div>
                <div className="text-foreground mt-2.5 text-xs leading-tight font-bold">
                  {layer.title}
                </div>
                <div className="text-muted-foreground mt-1 text-[10px] leading-tight">
                  {layer.sub}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Layer Insight Card */}
      <div className="border-border/80 bg-background/80 relative z-10 rounded-xl border p-4 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
              LAYER 0{current.id}
            </span>
            <span className="text-foreground text-sm font-bold">{current.title}</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {current.badge}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed sm:text-sm">
          {current.details}
        </p>
      </div>
    </div>
  )
}
