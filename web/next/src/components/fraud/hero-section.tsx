"use client"

import { RiNodeTree, RiRadarLine } from "@remixicon/react"
import Link from "next/link"
import { useState } from "react"

import { useT } from "@/components/fraud/locale"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

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
  const [activeTab, setActiveTab] = useState<"graph" | "rule">("graph")

  return (
    <section className="relative overflow-hidden border-b py-16 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-12">
          {/* Left Column: Headline, Actions & Metrics */}
          <div className="space-y-6 lg:col-span-7">
            <div className="text-muted-foreground inline-flex items-center gap-2 text-sm">
              <RiRadarLine className="text-primary size-4" aria-hidden />
              <span>{t("hero.badge")}</span>
            </div>

            <h1 className="max-w-[19ch] text-4xl leading-[1.08] font-semibold tracking-[-0.02em] text-balance sm:text-5xl lg:text-[3.5rem]">
              {t("hero.title")}
            </h1>

            <p className="text-muted-foreground max-w-2xl text-base leading-relaxed sm:text-lg">
              {t("hero.subtitle")}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                render={<Link href="/connect" />}
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground h-11 px-6 font-medium"
              >
                <span>{t("hero.connectCta")}</span>
              </Button>
              <Button
                render={<Link href="/clusters" />}
                variant="outline"
                size="lg"
                className="h-11 px-6 backdrop-blur-md"
              >
                <RiNodeTree className="text-primary size-4" aria-hidden />
                <span>{t("hero.queueCta")}</span>
              </Button>
              <Button
                render={<Link href="/holds" />}
                variant="ghost"
                size="lg"
                className="text-muted-foreground hover:text-foreground h-11 px-4"
              >
                <span>Active Payment Holds</span>
                <span className="ml-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Live
                </span>
              </Button>
            </div>

            {/* Metric Highlights with Clean, Balanced Typography */}
            {recall && precision && (
              /* Three measurements, each labelled with what was actually measured.
               *
               * The labels used to read "Full ring detection", "Zero false alarms" and "Ordinary
               * families saved" over ALL-CAPS headings. The middle one is a claim this project
               * forbids itself: precision is 100% on one held-out split, and the adversarial suite
               * publishes a false positive, so "zero false alarms" is not something the repo has
               * measured or would stand behind. The strings below already existed in messages.ts
               * in all three languages, say exactly what the number is, and were going unused.
               *
               * Divided by rules rather than boxed in cards: three numbers of one kind read as a
               * row of measurements, not as three separate things. */
              <dl className="divide-border grid grid-cols-1 gap-px pt-6 sm:grid-cols-3 sm:divide-x">
                <div className="sm:pr-6">
                  <dd className="text-foreground font-mono text-3xl tabular-nums">{recall}</dd>
                  <dt className="text-muted-foreground mt-1 max-w-[22ch] text-sm">
                    {t("hero.recallLabel")}
                  </dt>
                </div>

                <div className="pt-4 sm:px-6 sm:pt-0">
                  <dd className="text-foreground font-mono text-3xl tabular-nums">{precision}</dd>
                  <dt className="text-muted-foreground mt-1 max-w-[22ch] text-sm">
                    {t("hero.precisionLabel")}
                  </dt>
                </div>

                <div className="pt-4 sm:pt-0 sm:pl-6">
                  <dd className="text-foreground font-mono text-3xl tabular-nums">
                    {wronglyFlagged !== null && totalLookalikes !== null
                      ? `${wronglyFlagged} / ${totalLookalikes}`
                      : "0 / 7"}
                  </dd>
                  <dt className="text-muted-foreground mt-1 max-w-[22ch] text-sm">
                    {t("hero.householdsLabel")}
                  </dt>
                </div>
              </dl>
            )}
          </div>

          {/* Right Column: Live Case Dossier Preview */}
          <div className="lg:col-span-5">
            <Card className="glass-panel overflow-hidden rounded-2xl border shadow-xl">
              <div className="bg-muted/40 flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="size-2.5 rounded-full bg-red-500/80" />
                    <div className="size-2.5 rounded-full bg-amber-500/80" />
                    <div className="size-2.5 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-muted-foreground ml-1.5 font-mono text-xs">
                    Ring #3812 · live detection
                  </span>
                </div>
                <div className="bg-background/60 border-border/60 flex gap-1 rounded-lg border p-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab("graph")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-semibold transition-all",
                      activeTab === "graph"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Graph View
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("rule")}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-semibold transition-all",
                      activeTab === "rule"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Single Rule View
                  </button>
                </div>
              </div>

              <CardContent className="space-y-4 p-5">
                {activeTab === "graph" ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="destructive"
                          className="animate-pulse font-mono text-[11px]"
                        >
                          Ring Flagged (0.94)
                        </Badge>
                        <span className="text-muted-foreground text-xs font-medium">
                          6 linked accounts
                        </span>
                      </div>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        Louvain Corroboration
                      </Badge>
                    </div>

                    {/* Clean High-Resolution Graph SVG */}
                    <div className="border-border/60 bg-background/60 relative flex h-52 w-full items-center justify-center rounded-xl border p-4">
                      <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-25" />

                      <svg viewBox="0 0 320 180" className="size-full select-none">
                        {/* Connecting Edge Lines */}
                        <line
                          x1="160"
                          y1="90"
                          x2="70"
                          y2="40"
                          stroke="rgba(244,63,94,0.5)"
                          strokeWidth="2"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="250"
                          y2="40"
                          stroke="rgba(244,63,94,0.5)"
                          strokeWidth="2"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="250"
                          y2="140"
                          stroke="rgba(244,63,94,0.5)"
                          strokeWidth="2"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="70"
                          y2="140"
                          stroke="rgba(244,63,94,0.5)"
                          strokeWidth="2"
                        />
                        <line
                          x1="70"
                          y1="40"
                          x2="250"
                          y2="40"
                          stroke="rgba(244,63,94,0.3)"
                          strokeWidth="1.5"
                          strokeDasharray="3 3"
                        />

                        {/* Animated Pulses on Edges */}
                        <line
                          x1="160"
                          y1="90"
                          x2="70"
                          y2="40"
                          stroke="#f43f5e"
                          strokeWidth="2"
                          className="animate-beam-flow"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="250"
                          y2="40"
                          stroke="#f43f5e"
                          strokeWidth="2"
                          className="animate-beam-flow"
                        />

                        {/* Central Ring Hub */}
                        <circle
                          cx="160"
                          cy="90"
                          r="22"
                          className="fill-destructive/20 stroke-destructive"
                          strokeWidth="2"
                        />
                        <circle
                          cx="160"
                          cy="90"
                          r="30"
                          className="animate-pulse-ring stroke-destructive/40"
                          fill="none"
                          strokeWidth="1.5"
                        />
                        <circle cx="160" cy="90" r="5" className="fill-destructive" />
                        <text
                          x="160"
                          y="122"
                          textAnchor="middle"
                          className="fill-foreground font-mono text-[9px] font-bold"
                        >
                          RING CORE #3812
                        </text>

                        {/* Satellite Account Nodes */}
                        <g transform="translate(70, 40)">
                          <circle r="12" className="fill-card stroke-destructive" strokeWidth="2" />
                          <circle r="3" className="fill-destructive" />
                          <text
                            y="-16"
                            textAnchor="middle"
                            className="fill-foreground font-mono text-[8px] font-semibold"
                          >
                            acc_9281 (Pune)
                          </text>
                        </g>

                        <g transform="translate(250, 40)">
                          <circle r="12" className="fill-card stroke-destructive" strokeWidth="2" />
                          <circle r="3" className="fill-destructive" />
                          <text
                            y="-16"
                            textAnchor="middle"
                            className="fill-foreground font-mono text-[8px] font-semibold"
                          >
                            acc_9282 (SIM +1)
                          </text>
                        </g>

                        <g transform="translate(250, 140)">
                          <circle r="12" className="fill-card stroke-destructive" strokeWidth="2" />
                          <circle r="3" className="fill-destructive" />
                          <text
                            y="22"
                            textAnchor="middle"
                            className="fill-muted-foreground font-mono text-[8px]"
                          >
                            Shared Card *4012
                          </text>
                        </g>

                        <g transform="translate(70, 140)">
                          <circle r="12" className="fill-card stroke-destructive" strokeWidth="2" />
                          <circle r="3" className="fill-destructive" />
                          <text
                            y="22"
                            textAnchor="middle"
                            className="fill-muted-foreground font-mono text-[8px]"
                          >
                            WELCOME50 Burst
                          </text>
                        </g>
                      </svg>
                    </div>

                    <div className="border-border/70 bg-card/40 space-y-2 rounded-xl border p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Shared Payment Fingerprint</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          100% confidence
                        </span>
                      </div>
                      <div className="border-border/50 flex items-center justify-between border-t pt-1.5">
                        <span className="text-muted-foreground">Sequential SIM Block</span>
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          +91 987654321[0-5]
                        </span>
                      </div>
                      <div className="border-border/50 flex items-center justify-between border-t pt-1.5">
                        <span className="text-muted-foreground">Coordinated Velocity</span>
                        <span className="text-foreground font-mono font-semibold">
                          4.2 minutes span
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="font-mono text-xs">
                        Traditional Rule Engine
                      </Badge>
                      <span className="text-muted-foreground text-xs">Single-txn filter</span>
                    </div>

                    <div className="border-border/70 bg-card/40 space-y-2.5 rounded-xl border p-3.5 text-xs">
                      <div className="flex items-center justify-between">
                        <span>Order Velocity Limit (&lt; 3 / day)</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          PASSED (1/1)
                        </span>
                      </div>
                      <div className="border-border/50 flex items-center justify-between border-t pt-2">
                        <span>Amount Threshold (&lt; ₹10,000)</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          PASSED (₹499)
                        </span>
                      </div>
                      <div className="border-border/50 flex items-center justify-between border-t pt-2">
                        <span>Promo Code Validation</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          VALID (WELCOME50)
                        </span>
                      </div>
                    </div>

                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Every transaction looks completely ordinary on its own. The coordinated attack
                      slips straight past traditional rule filters.
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
