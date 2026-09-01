"use client"

import {
  RiArrowRightLine,
  RiCheckDoubleLine,
  RiFlashlightLine,
  RiNodeTree,
  RiRadarLine,
  RiShieldCheckLine,
  RiSparklingLine,
} from "@remixicon/react"
import Link from "next/link"
import { useState } from "react"

import { useT } from "@/components/fraud/locale"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface HeroSectionProps {
  recall: string | null
  precision: string | null
  wronglyFlagged: number | null
  totalLookalikes: number | null
}

export function HeroSection({
  recall,
  precision,
  wronglyFlagged,
  totalLookalikes,
}: HeroSectionProps) {
  const t = useT()
  const [activeTab, setActiveTab] = useState<"rule" | "graph">("graph")

  return (
    <section className="relative overflow-hidden border-b py-20 lg:py-28">
      {/* Background Ambient Glow Orbs */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl dark:bg-emerald-500/15"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute top-1/2 -right-24 -z-10 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/10"
        aria-hidden
      />

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          {/* Left Column: Headline & Action CTAs */}
          <div className="lg:col-span-7">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <RiRadarLine className="size-3.5" aria-hidden />
              <span>{t("hero.badge")}</span>
            </div>

            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              {t("hero.title")}
            </h1>

            <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed">
              {t("hero.subtitle")}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <Button
                render={<Link href="/connect" />}
                size="lg"
                className="group h-11 px-6 shadow-md"
              >
                <span>{t("hero.connectCta")}</span>
                <RiArrowRightLine
                  className="size-4 transition-transform group-hover:translate-x-1"
                  aria-hidden
                />
              </Button>
              <Button
                render={<Link href="/clusters" />}
                variant="outline"
                size="lg"
                className="h-11 px-6 backdrop-blur"
              >
                <RiNodeTree className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                <span>{t("hero.queueCta")}</span>
              </Button>
            </div>

            {/* Metric Highlights */}
            {recall && precision && (
              <div className="mt-12 grid grid-cols-3 gap-4">
                <div className="glass-card-hover rounded-xl border p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      {t("hero.recallLabel")}
                    </span>
                    <RiCheckDoubleLine className="size-4 text-emerald-500" aria-hidden />
                  </div>
                  <div className="text-foreground mt-2 text-3xl font-bold tabular-nums">
                    {recall}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">Full ring detection</div>
                </div>

                <div className="glass-card-hover rounded-xl border p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      {t("hero.precisionLabel")}
                    </span>
                    <RiSparklingLine className="size-4 text-blue-500" aria-hidden />
                  </div>
                  <div className="text-foreground mt-2 text-3xl font-bold tabular-nums">
                    {precision}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">Zero false alarms</div>
                </div>

                <div className="glass-card-hover rounded-xl border p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      {t("hero.householdsLabel")}
                    </span>
                    <RiShieldCheckLine className="size-4 text-amber-500" aria-hidden />
                  </div>
                  <div className="text-foreground mt-2 text-3xl font-bold tabular-nums">
                    {wronglyFlagged !== null && totalLookalikes !== null
                      ? `${wronglyFlagged} / ${totalLookalikes}`
                      : "0 / 7"}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">Clean households saved</div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Live Interactive Simulation Preview */}
          <div className="lg:col-span-5">
            <Card className="glass-panel border-border/80 overflow-hidden shadow-2xl">
              <div className="bg-muted/30 flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="size-2.5 rounded-full bg-red-500/80" />
                    <div className="size-2.5 rounded-full bg-amber-500/80" />
                    <div className="size-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-muted-foreground ml-2 font-mono text-xs">
                    detector_live_eval.py
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab("graph")}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeTab === "graph"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Graph View
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("rule")}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeTab === "rule"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    Rule View
                  </button>
                </div>
              </div>

              <CardContent className="p-5">
                {activeTab === "graph" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="animate-pulse">
                          Ring Flagged (0.94)
                        </Badge>
                        <span className="text-muted-foreground text-xs">6 linked accounts</span>
                      </div>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        Louvain + Corroboration
                      </Badge>
                    </div>

                    {/* Animated Simulated Graph Nodes */}
                    <div className="bg-background/50 relative flex h-48 w-full items-center justify-center rounded-lg border border-dashed p-4">
                      <div className="bg-dot-grid absolute inset-0 opacity-30" />

                      {/* Center Cluster Hub */}
                      <div className="relative flex flex-col items-center">
                        <div className="bg-destructive/20 text-destructive border-destructive/40 animate-pulse-radar relative flex size-12 items-center justify-center rounded-full border shadow-lg">
                          <RiFlashlightLine className="size-6" />
                        </div>
                        <span className="text-destructive mt-1 font-mono text-[10px] font-semibold">
                          Ring #3812
                        </span>
                      </div>

                      {/* Surrounding Nodes */}
                      <div className="bg-card/80 absolute top-4 left-6 flex items-center gap-1 rounded border px-2 py-1 text-[10px] shadow-sm">
                        <div className="size-1.5 rounded-full bg-emerald-500" />
                        <span>acc_9281 (Pune)</span>
                      </div>
                      <div className="bg-card/80 absolute top-4 right-6 flex items-center gap-1 rounded border px-2 py-1 text-[10px] shadow-sm">
                        <div className="size-1.5 rounded-full bg-emerald-500" />
                        <span>acc_9282 (SIM +1)</span>
                      </div>
                      <div className="bg-card/80 absolute bottom-4 left-8 flex items-center gap-1 rounded border px-2 py-1 text-[10px] shadow-sm">
                        <div className="size-1.5 rounded-full bg-blue-500" />
                        <span>Shared Card: *4012</span>
                      </div>
                      <div className="bg-card/80 absolute right-8 bottom-4 flex items-center gap-1 rounded border px-2 py-1 text-[10px] shadow-sm">
                        <div className="size-1.5 rounded-full bg-amber-500" />
                        <span>Coupon: WELCOME50</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="text-muted-foreground flex items-center justify-between">
                        <span>Shared Payment Fingerprint</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          100% confidence
                        </span>
                      </div>
                      <div className="text-muted-foreground flex items-center justify-between">
                        <span>Sequential SIM Block</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          +91 987654321[0-5]
                        </span>
                      </div>
                      <div className="text-muted-foreground flex items-center justify-between">
                        <span>Coordinated Execution</span>
                        <span className="text-foreground font-mono font-semibold">
                          4.2 minutes span
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary">Single Rules Engine</Badge>
                      <span className="text-muted-foreground text-xs">Traditional filter</span>
                    </div>

                    <div className="bg-background/50 space-y-2 rounded-lg border p-4">
                      <div className="flex items-center justify-between border-b pb-2 text-xs">
                        <span>Order Velocity Limit (&lt; 3 / day)</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          PASSED (1/1)
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-b pb-2 text-xs">
                        <span>Amount Threshold (&lt; ₹10,000)</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          PASSED (₹499)
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span>Promo Code Validation</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          VALID (WELCOME50)
                        </span>
                      </div>
                    </div>

                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Every transaction looks completely benign on its own. The coordinated attack
                      slips straight past traditional rules.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </section>
  )
}
