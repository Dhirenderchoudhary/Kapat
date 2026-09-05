"use client"

import { RiNodeTree, RiRadarLine } from "@remixicon/react"
import Link from "next/link"
import { useState } from "react"

import { RouteProgress } from "@/components/common/route-progress"
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

/** Two readings of the same payment, named in sentence case like every other label in the app.
 *  They were "Graph View" and "Single Rule View", the only Title Case in the console chrome. */
const TABS = [
  { id: "graph", label: "As a graph" },
  { id: "rule", label: "As one rule" },
] as const

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
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12">
          {/* Left Column: Headline, Actions & Metrics */}
          <div className="min-w-0 space-y-6 lg:col-span-7">
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
                <RouteProgress />
              </Button>
              <Button
                render={<Link href="/clusters" />}
                variant="outline"
                size="lg"
                className="h-11 px-6 backdrop-blur-md"
              >
                <RiNodeTree className="text-primary size-4" aria-hidden />
                <span>{t("hero.queueCta")}</span>
                <RouteProgress />
              </Button>
              <Button
                render={<Link href="/#pricing" />}
                variant="ghost"
                size="lg"
                className="text-muted-foreground hover:text-foreground h-11 px-4"
              >
                <span>₹500 / month</span>
                <RouteProgress />
              </Button>
              <Button
                render={<Link href="/holds" />}
                variant="ghost"
                size="lg"
                className="text-muted-foreground hover:text-foreground h-11 px-4"
              >
                <span>Held payments</span>
                <span className="ml-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  Live
                </span>
                <RouteProgress />
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
          <div className="min-w-0 lg:col-span-5">
            <Card className="glass-panel overflow-hidden rounded-2xl border shadow-xl">
              <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                {/* The three macOS traffic-light dots that used to sit here were decoration, and
                    one of them was red. On a console whose whole colour discipline is that the one
                    red thing always means strong fraud evidence, spending a red on a window-chrome
                    ornament is the most expensive decoration on the page. */}
                <span className="text-muted-foreground font-mono text-xs">
                  Ring #3812 · live detection
                </span>
                {/* A real tablist. These were two loose <button>s: nothing told a screen reader
                    they were two views of one thing or which was showing, and arrow keys did
                    nothing. The panel below is wired to whichever is selected. */}
                <div
                  role="tablist"
                  aria-label="Preview"
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
                    e.preventDefault()
                    const next = activeTab === "graph" ? "rule" : "graph"
                    setActiveTab(next)
                    // Roving tabindex: the tab that becomes selected is the one that becomes
                    // tabbable, so focus has to follow it or the next Tab press leaves the group
                    // from a control the user is no longer on.
                    document.getElementById(`hero-tab-${next}`)?.focus()
                  }}
                  className="bg-background/60 border-border/60 flex gap-1 rounded-lg border p-0.5"
                >
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      id={`hero-tab-${tab.id}`}
                      aria-selected={activeTab === tab.id}
                      aria-controls={`hero-panel-${tab.id}`}
                      tabIndex={activeTab === tab.id ? 0 : -1}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "focus-visible:ring-ring rounded px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
                        activeTab === tab.id
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <CardContent className="space-y-4 p-5">
                {activeTab === "graph" ? (
                  <div
                    id="hero-panel-graph"
                    role="tabpanel"
                    aria-labelledby="hero-tab-graph"
                    className="space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {/* The badge used to pulse. Nothing was arriving and nothing was changing,
                          so the motion was announcing urgency the page had not earned. */}
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="font-mono text-[11px]">
                          Flagged 0.94
                        </Badge>
                        <span className="text-muted-foreground text-xs font-medium">
                          6 linked accounts
                        </span>
                      </div>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        Louvain + corroboration
                      </Badge>
                    </div>

                    {/* The graph, drawn from the evidence palette rather than from a hex.
                        Every edge was rgba(244,63,94) - a rose that lives in no token, so it
                        neither shifted for dark mode nor matched the crimson the charts, badges
                        and detail page use for the same thing. Worse, painting all five edges the
                        same red said all five links are equally damning, which is the opposite of
                        this product's argument: a shared card is what a family looks like. Each
                        edge now carries the colour of its own signal class, and the two that
                        carry the flag are the two that animate. */}
                    <div className="border-border/60 bg-background/60 relative flex h-52 w-full items-center justify-center rounded-xl border p-4">
                      <div className="bg-dot-grid pointer-events-none absolute inset-0 opacity-25" />

                      <svg
                        viewBox="0 0 320 180"
                        className="size-full select-none"
                        role="img"
                        aria-label="Six accounts linked by a sequential SIM block and one promo code, plus a shared card and matching order times."
                      >
                        {/* Benign edges: a household produces these too. */}
                        <line
                          x1="160"
                          y1="90"
                          x2="70"
                          y2="40"
                          className="stroke-evidence-benign/60"
                          strokeWidth="1.5"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="250"
                          y2="140"
                          className="stroke-evidence-benign/60"
                          strokeWidth="1.5"
                        />

                        {/* Weakly fraud-specific: real households order together as well. */}
                        <line
                          x1="70"
                          y1="40"
                          x2="250"
                          y2="40"
                          className="stroke-evidence-weak/70"
                          strokeWidth="1.5"
                          strokeDasharray="3 3"
                        />

                        {/* Strong: no household explanation. These are the two that carry the flag,
                            so these are the two that move. */}
                        <line
                          x1="160"
                          y1="90"
                          x2="250"
                          y2="40"
                          className="stroke-evidence-strong/50"
                          strokeWidth="2.5"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="70"
                          y2="140"
                          className="stroke-evidence-strong/50"
                          strokeWidth="2.5"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="250"
                          y2="40"
                          className="stroke-evidence-strong animate-beam-flow"
                          strokeWidth="2.5"
                        />
                        <line
                          x1="160"
                          y1="90"
                          x2="70"
                          y2="140"
                          className="stroke-evidence-strong animate-beam-flow"
                          strokeWidth="2.5"
                        />

                        {/* The flagged group itself. */}
                        <circle
                          cx="160"
                          cy="90"
                          r="22"
                          className="fill-evidence-strong/15 stroke-evidence-strong"
                          strokeWidth="2"
                        />
                        <circle
                          cx="160"
                          cy="90"
                          r="30"
                          className="animate-pulse-ring stroke-evidence-strong/40"
                          fill="none"
                          strokeWidth="1.5"
                        />
                        <circle cx="160" cy="90" r="5" className="fill-evidence-strong" />
                        <text
                          x="160"
                          y="122"
                          textAnchor="middle"
                          className="fill-foreground font-mono text-[9px] font-semibold"
                        >
                          ring #3812
                        </text>

                        {/* Accounts. Nodes are outlined in the class of the edge that reaches
                            them, so a card-sharing account does not look as damning as a SIM-block
                            one. */}
                        <g transform="translate(70, 40)">
                          <circle
                            r="12"
                            className="fill-card stroke-evidence-benign"
                            strokeWidth="2"
                          />
                          <circle r="3" className="fill-evidence-benign" />
                          <text
                            y="-16"
                            textAnchor="middle"
                            className="fill-muted-foreground font-mono text-[8px]"
                          >
                            acc_9281
                          </text>
                        </g>

                        <g transform="translate(250, 40)">
                          <circle
                            r="12"
                            className="fill-card stroke-evidence-strong"
                            strokeWidth="2"
                          />
                          <circle r="3" className="fill-evidence-strong" />
                          <text
                            y="-16"
                            textAnchor="middle"
                            className="fill-foreground font-mono text-[8px] font-semibold"
                          >
                            SIM +1
                          </text>
                        </g>

                        <g transform="translate(250, 140)">
                          <circle
                            r="12"
                            className="fill-card stroke-evidence-benign"
                            strokeWidth="2"
                          />
                          <circle r="3" className="fill-evidence-benign" />
                          <text
                            y="22"
                            textAnchor="middle"
                            className="fill-muted-foreground font-mono text-[8px]"
                          >
                            card *4012
                          </text>
                        </g>

                        <g transform="translate(70, 140)">
                          <circle
                            r="12"
                            className="fill-card stroke-evidence-strong"
                            strokeWidth="2"
                          />
                          <circle r="3" className="fill-evidence-strong" />
                          <text
                            y="22"
                            textAnchor="middle"
                            className="fill-foreground font-mono text-[8px] font-semibold"
                          >
                            WELCOME50
                          </text>
                        </g>
                      </svg>
                    </div>

                    {/* The legend for the picture above, in the order the score weights them.
                        Each row carries the swatch of its own edge, so the graph is readable
                        without hovering it, and the two rows that carry the flag say why in
                        words. The values used to be printed in the accent colour, which made a
                        phone-number range look like a link and gave the same emphasis to a card
                        fingerprint that a family also shares. */}
                    <dl className="border-border/70 bg-card/40 divide-border/50 divide-y rounded-xl border p-3 text-xs">
                      {[
                        {
                          swatch: "bg-evidence-strong",
                          term: "Sequential SIM block",
                          value: "+91 987654321[0-5]",
                          note: "No household buys consecutive numbers.",
                        },
                        {
                          swatch: "bg-evidence-strong",
                          term: "One promo code, six accounts",
                          value: "WELCOME50",
                          note: "A family has no reason to split one code.",
                        },
                        {
                          swatch: "bg-evidence-weak",
                          term: "Orders within minutes",
                          value: "4.2 minute span",
                          note: "Real households do this too, so it counts for less.",
                        },
                        {
                          swatch: "bg-evidence-benign",
                          term: "Shared card",
                          value: "*4012",
                          note: "Ordinary in a family. Not counted.",
                        },
                      ].map((row) => (
                        <div key={row.term} className="py-1.5 first:pt-0 last:pb-0">
                          <div className="flex items-baseline justify-between gap-3">
                            <dt className="text-foreground flex items-center gap-1.5">
                              <span
                                className={cn("size-1.5 shrink-0 rounded-full", row.swatch)}
                                aria-hidden
                              />
                              {row.term}
                            </dt>
                            <dd className="text-muted-foreground shrink-0 font-mono">
                              {row.value}
                            </dd>
                          </div>
                          <p className="text-muted-foreground mt-0.5 pl-3">{row.note}</p>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : (
                  <div
                    id="hero-panel-rule"
                    role="tabpanel"
                    aria-labelledby="hero-tab-rule"
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="font-mono text-xs">
                        Transaction rules
                      </Badge>
                      <span className="text-muted-foreground text-xs">One payment at a time</span>
                    </div>

                    {/* The three checks, in sentence case and without the accent colour.
                        "PASSED" in green said the good news was that the payment cleared, when the
                        point of this panel is the opposite: every check passing is exactly how the
                        ring gets through. The verdict is left to the sentence below, which is the
                        only thing on this panel that should be read as a conclusion. */}
                    <dl className="border-border/70 bg-card/40 divide-border/50 divide-y rounded-xl border p-3.5 text-xs">
                      {[
                        { term: "Orders per day, under 3", value: "1 of 3" },
                        { term: "Amount under ₹10,000", value: "₹499" },
                        { term: "Promo code valid", value: "WELCOME50" },
                      ].map((row) => (
                        <div
                          key={row.term}
                          className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                        >
                          <dt className="text-foreground">{row.term}</dt>
                          <dd className="text-muted-foreground shrink-0 font-mono">{row.value}</dd>
                        </div>
                      ))}
                    </dl>

                    <p className="text-muted-foreground text-xs leading-relaxed">
                      Each payment passes every check on its own. The coordination between the six
                      accounts is the only thing that gives the ring away, and no rule that looks at
                      one payment can see it.
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
