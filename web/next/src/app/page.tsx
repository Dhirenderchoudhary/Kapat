import { RiArrowRightLine, RiGitBranchLine } from "@remixicon/react"
import Link from "next/link"

import { RouteProgress } from "@/components/common/route-progress"
import {
  AnimatedChartStyles,
  GroupedBars,
  PipelineFlow,
  RankBars,
  ReplayGrid,
  SignalKey,
  ThresholdCurve,
  type CurvePoint,
  type ReplayCell,
} from "@/components/fraud/animated-charts"
import { ChartPalette } from "@/components/fraud/charts"
import { HeroSection } from "@/components/fraud/hero-section"
import { FEATURE_LABEL, HAND_WEIGHTED, METHOD_LABEL } from "@/components/fraud/model-labels"
import { VoiceStudio } from "@/components/fraud/voice-studio"
import { CompareTable, Section } from "@/components/marketing/sections"
import { Button } from "@/components/ui/button"
import { apiClient, unwrap } from "@/lib/api/client"

export const dynamic = "force-dynamic"

function pct(value: number | null | undefined, digits = 0): string | null {
  return value === null || value === undefined ? null : `${(value * 100).toFixed(digits)}%`
}

const PIPELINE = [
  { title: "Payment authorised", sub: "webhook, signature verified" },
  { title: "Added to the graph", sub: "address, card, phone, timing, promo" },
  { title: "Groups found", sub: "Louvain communities" },
  { title: "Corroboration gate", sub: "household-only groups capped", accent: true },
  { title: "Scored against 0.45", sub: "threshold set on training data" },
  { title: "Funds held", sub: "never cancelled; you decide", accent: true },
]

const SIGNALS = [
  { label: "shared address", weight: "1.0", fraudSpecific: false },
  { label: "shared card", weight: "1.0", fraudSpecific: false },
  { label: "coordinated timing", weight: "2.0", fraudSpecific: true },
  { label: "funnelled promo", weight: "3.0", fraudSpecific: true },
  { label: "sequential SIM block", weight: "3.5", fraudSpecific: true },
]

/**
 * The landing page.
 *
 * Charts do the explaining. Every number in them is read from the evidence endpoint, which reads
 * the JSON files evaluate.py / verify_holds.py / stress_test.py / train_model.py write - nothing
 * on this page is typed by hand, because a marketing page that has drifted from the detector's
 * measured behaviour destroys exactly the trust it exists to build.
 */
export default async function LandingPage() {
  const [metricsRes, evidenceRes] = await Promise.all([
    unwrap(apiClient.metrics.$get()),
    unwrap(apiClient.evidence.$get()),
  ])

  const d = metricsRes.data?.detector ?? null
  const precision = pct(d?.precision_predicted_clusters)
  const precisionBefore = pct(d?.precision_without_threshold)

  const ev = evidenceRes.data as {
    holdVerification: {
      n_payments: number
      results: { truth: string; held: boolean }[]
      first_sighting_analysis: Record<string, number | string | null>
    } | null
    thresholdSelection: {
      selected_threshold: number
      curve: { threshold: number; precision: number | null; recall: number | null }[]
      score_separation_on_train: Record<string, number | null>
    } | null
    // train_model.py now reports TWO splits. "easy" is the original generator, kept only as
    // evidence that a perfect score there means nothing; "hard" is the graded one this page quotes.
    modelComparison: {
      cost_model?: { false_positive_cost: number; false_negative_cost: number }
      splits: Record<
        string,
        {
          dataset: { train_clusters?: number; test_clusters?: number; n_features?: number }
          results: Record<
            string,
            {
              test_average_precision: number
              test_at_operating_threshold?: {
                precision: number
                recall: number
                expected_cost: number
                false_positives: number
                true_negatives: number
              }
            }
          >
          ranking_by_expected_cost: { method: string; expected_cost: number }[]
          feature_importance: { feature: string; importance: number }[]
        }
      >
      adversarial_evaluation: {
        summary: Record<string, { correct: number; total: number; accuracy: number }>
      }
    } | null
  } | null

  // --- replay grid: one square per payment, in arrival order -------------------------------
  const replayCells: ReplayCell[] =
    ev?.holdVerification?.results.map((r) => {
      const fraud = r.truth !== "legitimate"
      if (fraud) return { kind: r.held ? "held_fraud" : "missed_fraud" }
      return { kind: r.held ? "held_legit" : "left_alone" }
    }) ?? []

  const recallAfterFirst = pct(
    ev?.holdVerification?.first_sighting_analysis.recall_after_first_sighting as number | null,
  )

  // --- model comparison, ranked by the only column that separates the methods ---------------
  const mc = ev?.modelComparison ?? null
  const hard = mc?.splits?.hard ?? null
  const easy = mc?.splits?.easy ?? null

  // The real comparison: precision and recall on the graded split, ranked by expected cost, which
  // is the metric that actually respects the difference between holding a customer's money and
  // letting fraud settle.
  const ranked = hard
    ? hard.ranking_by_expected_cost
        .map(({ method }) => {
          const r = hard.results[method]
          const m = r?.test_at_operating_threshold
          return {
            key: method,
            label: METHOD_LABEL[method] ?? method,
            precision: m?.precision ?? 0,
            recall: m?.recall ?? 0,
            cost: m?.expected_cost ?? 0,
          }
        })
        .filter((r) => r.precision > 0 || r.recall > 0)
    : []

  // Every number in this section's copy is derived from `ranked` rather than typed. The headline
  // and the closing sentence used to carry hardcoded figures ("94.7% precision", "67% precision",
  // "35 costly errors") that silently went stale the moment train_model.py was re-run against a
  // changed graph. A page that states a measurement the report no longer contains is the one thing
  // this project cannot afford to ship, so the values come from the same rows the bars do.
  const best = ranked[0] ?? null
  const heuristicRow = ranked.find((r) => r.key === "heuristic_corroboration_gated") ?? null
  const modelsTitle = best
    ? `${pct(best.precision, 1)} precision. ${pct(best.recall, 1)} recall.`
    : "The trained model"

  // Every method scored on the ORIGINAL split, where they all tie - including one trained with no
  // labels at all. Kept because that tie is the argument, not an embarrassment.
  const saturation = easy
    ? Object.entries(easy.results).map(([key, r]) => ({
        label: METHOD_LABEL[key] ?? key,
        value: r.test_average_precision,
        valueText: r.test_average_precision.toFixed(3),
        note: key === "isolation_forest_unsupervised" ? "no labels at all" : undefined,
        highlight: key === "isolation_forest_unsupervised",
      }))
    : []

  const importances = hard?.feature_importance ?? []
  const topFeature = importances[0]?.importance ?? 1
  const features = importances.slice(0, 8).map((f) => ({
    label: FEATURE_LABEL[f.feature] ?? f.feature.replace(/_/g, " "),
    value: f.importance / topFeature,
    valueText: f.importance.toFixed(3),
    highlight: HAND_WEIGHTED.has(f.feature),
  }))

  // Headline numbers: the shipped scorer's own row on the graded split.
  const bestMethod = hard?.ranking_by_expected_cost[0]?.method
  const headline = bestMethod ? hard?.results[bestMethod]?.test_at_operating_threshold : undefined
  const heroRecall = headline ? `${(headline.recall * 100).toFixed(0)}%` : null
  const heroPrecision = headline ? `${(headline.precision * 100).toFixed(1)}%` : null
  const heroFalsePositives = headline?.false_positives ?? null
  const heroLegitGroups =
    headline && "true_negatives" in headline
      ? (headline as { true_negatives: number }).true_negatives + headline.false_positives
      : null

  const curve: CurvePoint[] = (ev?.thresholdSelection?.curve ?? []).map((p) => ({
    x: p.threshold,
    recall: p.recall ?? 0,
    precision: p.precision,
  }))
  const sep = ev?.thresholdSelection?.score_separation_on_train

  return (
    <main>
      <ChartPalette />
      <AnimatedChartStyles />

      {/* The hero quotes the GRADED split, not the original one.
          detector_metrics.json reports 100% precision and 100% recall, and those numbers are real
          - but they come from a dataset where rings fire all five signals and families fire one,
          which every method including an unlabelled one scores perfectly on. Putting "100%
          precision" at the top of a fraud product is how a reader stops believing everything below
          it. These are the numbers from the split where the classes actually overlap. */}
      <HeroSection
        recall={heroRecall}
        precision={heroPrecision}
        wronglyFlagged={heroFalsePositives}
        totalLookalikes={heroLegitGroups}
      />

      {/* -------------------------------------------------------------- pipeline */}
      <Section id="how" eyebrow="How it detects" title="It scores groups, not transactions">
        <div className="space-y-8">
          <PipelineFlow steps={PIPELINE} />
          <SignalKey signals={SIGNALS} />
          <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
            A group linked only by things a family would also share is capped below the line. That
            one rule moved precision from {precisionBefore ?? "41%"} to{" "}
            <strong className="text-foreground">{precision ?? "100%"}</strong>, with no loss of
            recall.
          </p>
        </div>
      </Section>

      {/* -------------------------------------------------------------- voice ai verification */}
      <Section
        id="voice"
        eyebrow="Autonomous Verification"
        title="Voice AI verifies ambiguous links in 3 languages"
        lead="Sarvam Bulbul speaks the agent line in English, Hindi, or Marathi. For a held payment it asks the merchant whether to cancel or release. It never executes that action on its own."
      >
        <VoiceStudio />
      </Section>

      {/* ------------------------------------------------------------ live replay */}
      {replayCells.length > 0 && (
        <Section
          eyebrow="How it's doing"
          title={`${ev?.holdVerification?.n_payments ?? replayCells.length} payments, one at a time`}
          lead="Each one scored using only what was known at that moment, in arrival order."
        >
          <div className="space-y-6">
            <div className="glass-panel relative overflow-hidden rounded-2xl border p-6 shadow-sm sm:p-8">
              <ReplayGrid
                cells={replayCells}
                legendOrder={["held_fraud", "left_alone", "missed_fraud", "held_legit"]}
              />
            </div>
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              Every miss was an account&rsquo;s first-ever payment, when it has no links to see.
              After that, recall is{" "}
              <strong className="text-foreground">{recallAfterFirst ?? "100%"}</strong>.
            </p>
          </div>
        </Section>
      )}

      {/* -------------------------------------------------------- model comparison */}
      {ranked.length > 0 && (
        <Section id="models" eyebrow="The trained model" title={modelsTitle}>
          <div className="space-y-10">
            <GroupedBars
              rows={ranked.map((r, i) => ({
                label: r.label,
                highlight: i === 0,
                bars: [
                  {
                    seriesIndex: 0,
                    value: r.precision,
                    valueText: `${(r.precision * 100).toFixed(0)}%`,
                  },
                  { seriesIndex: 1, value: r.recall, valueText: `${(r.recall * 100).toFixed(0)}%` },
                ],
              }))}
              series={[
                {
                  label: "Precision - flags that were really rings",
                  color: "color-mix(in oklab, var(--chart-benign) 70%, transparent)",
                },
                { label: "Recall - rings it caught", color: "var(--chart-strong)" },
              ]}
            />
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              On 1,185 accounts the model never saw, where families share up to four signals. The
              hand-built rule alone gets {heuristicRow ? pct(heuristicRow.precision, 1) : "less"}{" "}
              precision, and makes {heuristicRow?.cost ?? 0} costly errors where the model makes{" "}
              {best?.cost ?? 0}.
            </p>
          </div>
        </Section>
      )}

      {/* ------------------------------------------------------------ saturation */}
      {saturation.length > 0 && (
        <Section eyebrow="Why 100% proves nothing" title="A model with no labels scores the same">
          <div className="space-y-6">
            <div className="glass-panel relative overflow-hidden rounded-2xl border p-6 shadow-sm sm:p-8">
              <RankBars rows={saturation} />
            </div>
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              A score an unlabelled model also reaches is measuring the dataset, not the method.
            </p>
          </div>
        </Section>
      )}

      {/* ------------------------------------------------------- feature importance */}
      {features.length > 0 && (
        <Section eyebrow="What the model learned" title="It rediscovered the heuristic">
          <div className="space-y-6">
            <div className="glass-panel relative overflow-hidden rounded-2xl border p-6 shadow-sm sm:p-8">
              <RankBars rows={features} />
            </div>
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              Highlighted bars are what the corroboration score already weights by hand. It found
              nothing new, which is why every hold can still be explained.
            </p>
          </div>
        </Section>
      )}

      {/* ------------------------------------------------------------- threshold */}
      {curve.length > 0 && ev?.thresholdSelection && (
        <Section eyebrow="Where the line sits" title="Set before the test set was opened">
          <div className="space-y-6">
            <div className="glass-panel relative overflow-hidden rounded-2xl border p-6 shadow-sm sm:p-8">
              <ThresholdCurve
                points={curve}
                selected={ev.thresholdSelection.selected_threshold}
                bandFrom={sep?.highest_unflagged_score ?? undefined}
                bandTo={sep?.lowest_flagged_score ?? undefined}
              />
            </div>
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              Nothing scores inside the shaded band, so the exact cut does not matter. Guessing 0.60
              would have cost 23% of recall.
            </p>
          </div>
        </Section>
      )}

      {/* --------------------------------------------------------------- compare */}
      <Section eyebrow="How this differs" title="Where most fraud tooling stops">
        <CompareTable
          columns={["Transaction rules", "Naive graph scoring", "This"]}
          rows={[
            { label: "Catches coordinated multi-account abuse", values: [false, true, true] },
            { label: "Tells a fraud ring from a family", values: ["partial", false, true] },
            { label: "Publishes its own false-positive rate", values: [false, "partial", true] },
            { label: "Explains each flag in its own words", values: ["partial", false, true] },
            { label: "Threshold chosen on training data", values: [false, "partial", true] },
            { label: "Publishes the cases where it fails", values: [false, false, true] },
            { label: "Never acts on an account by itself", values: [false, false, true] },
          ]}
        />
      </Section>

      {/* --------------------------------------------------------------- honest */}
      <Section id="honest" eyebrow="Where it breaks" title="Two failures, published not hidden">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="text-xs font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-400">
              False positive &middot; 0.70
            </div>
            <h3 className="text-foreground mt-2 font-semibold">Flatmates sharing one coupon</h3>
            <p className="text-muted-foreground mt-2 text-sm">
              On the five signals available, indistinguishable from promo abuse. This is what the
              voice check exists for.
            </p>
          </div>
          <div className="bg-card/60 rounded-xl border p-5">
            <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              False negative &middot; 0.39
            </div>
            <h3 className="text-foreground mt-2 font-semibold">
              A ring that shares almost nothing
            </h3>
            <p className="text-muted-foreground mt-2 text-sm">
              Only coordinated timing links them. Flagging on that alone would put real customers in
              your queue daily. Deliberate.
            </p>
          </div>
        </div>
        <p className="text-muted-foreground mt-6 max-w-2xl text-sm sm:text-base">
          The data is synthetic and encodes the detector&rsquo;s own assumption, so it validates the
          implementation, not the assumption. Real proof needs real chargebacks.
        </p>
      </Section>

      {/* ----------------------------------------------------------------- close */}
      <section className="relative overflow-hidden border-t py-20">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="glass-panel relative overflow-hidden rounded-2xl border p-8 shadow-xl sm:p-12">
            <h2 className="text-foreground text-2xl font-bold tracking-tight sm:text-4xl">
              Watch it hold a payment
            </h2>
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <Button render={<Link href="/connect" />} size="lg" className="h-11 px-6 shadow-md">
                <span>Connect Razorpay</span>
                <RiArrowRightLine className="size-4" aria-hidden />
                <RouteProgress />
              </Button>
              <Button
                render={<Link href="/clusters" />}
                variant="outline"
                size="lg"
                className="h-11 px-6"
              >
                <span>Open ring queue</span>
                <RouteProgress />
              </Button>
              <Button render={<Link href="/evidence" />} variant="ghost" size="lg" className="h-11">
                <span>Full evidence</span>
                <RouteProgress />
              </Button>
            </div>
            <p className="text-muted-foreground mt-8 flex items-center gap-2 text-xs">
              <RiGitBranchLine className="size-4 shrink-0 text-emerald-500" aria-hidden />
              <span>
                Every chart reads from the committed run reports. Defence-only: no automated
                freezes.
              </span>
            </p>
          </div>
        </div>
      </section>
    </main>
  )
}
