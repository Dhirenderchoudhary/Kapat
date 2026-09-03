import { RiAlertLine, RiCheckLine, RiFlaskLine } from "@remixicon/react"
import Link from "next/link"

import {
  AnimatedChartStyles,
  GroupedBars,
  RankBars,
  ReplayGrid,
  ThresholdCurve,
  type CurvePoint,
  type ReplayCell,
} from "@/components/fraud/animated-charts"
import { ChartPalette } from "@/components/fraud/charts"
import { FEATURE_LABEL, HAND_WEIGHTED, METHOD_LABEL } from "@/components/fraud/model-labels"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, unwrap } from "@/lib/api/client"

export const dynamic = "force-dynamic"

type StressCase = {
  case: string
  expectation: "flagged" | "not_flagged"
  note: string
  risk_score: number
  flagged: boolean
  correct: boolean
  signal_types_present: string[]
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "-" : `${(v * 100).toFixed(1)}%`
}

function Missing({ file, cmd }: { file: string; cmd: string }) {
  return (
    <div className="rounded-lg border border-dashed p-5">
      <p className="text-sm font-medium">Not generated yet</p>
      <p className="text-muted-foreground mt-1 text-sm">
        <code className="font-mono text-xs">data/{file}</code> does not exist. Run:
      </p>
      <pre className="bg-muted/60 mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs">
        <code>{cmd}</code>
      </pre>
    </div>
  )
}

/**
 * The evidence page.
 *
 * A merchant cannot audit a detector they did not build, and "trust us" is not an answer. So this
 * shows every measurement the repository actually produces - including the adversarial cases the
 * detector FAILS, which are given the same prominence as the ones it passes. A detector whose
 * limits you cannot see is one you cannot safely act on, and publishing the failures is the only
 * version of this page that is worth reading.
 */
export default async function EvidencePage() {
  const { data, error } = await unwrap(apiClient.evidence.$get())

  if (error || !data) {
    return (
      <PageShell size="lg">
        <PageHeader title="Evidence" description="Everything measured about this detector." />
        <div className="rounded-lg border p-5">
          <p className="text-destructive text-sm">
            Couldn&apos;t load the evidence: {error?.message}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            If this says a network or 404 error, the API container is probably running an older
            build that predates this endpoint. Rebuild it with{" "}
            <code className="font-mono text-xs">docker compose up --build -d</code>.
          </p>
        </div>
      </PageShell>
    )
  }

  const d = data as {
    detectorMetrics: Record<string, unknown> | null
    stressTest: { n_cases: number; n_correct: number; results: StressCase[] } | null
    holdVerification: Record<string, unknown> | null
    thresholdSelection: {
      selected_threshold: number
      curve: { threshold: number; precision: number | null; recall: number | null }[]
      score_separation_on_train: Record<string, number | null>
    } | null
    modelComparison: {
      results: Record<string, { test_average_precision: number }>
      adversarial_evaluation: {
        summary: Record<
          string,
          {
            correct: number
            total: number
            accuracy: number
            failures: { case: string; expected: string; score: number; kind: string }[]
          }
        >
      }
      random_forest_feature_importance: { feature: string; importance: number }[]
    } | null
    howToRegenerate: Record<string, string>
  }

  const dm = d.detectorMetrics as {
    recall_true_rings: number | null
    precision_predicted_clusters: number | null
    precision_without_threshold: number | null
    n_lookalikes: number
    n_lookalikes_wrongly_flagged: number
    flag_threshold: number
  } | null

  const hv = d.holdVerification as {
    n_payments: number
    results: { truth: string; held: boolean }[]
    confusion_matrix: Record<string, number>
    metrics: Record<string, number | null>
    class_balance: Record<string, number>
    first_sighting_analysis: Record<string, number | string | null>
  } | null

  // One square per payment, in the order they arrived - which is the order the detector saw them.
  const replayCells: ReplayCell[] =
    hv?.results.map((r) => {
      const fraud = r.truth !== "legitimate"
      if (fraud) return { kind: r.held ? "held_fraud" : "missed_fraud" }
      return { kind: r.held ? "held_legit" : "left_alone" }
    }) ?? []

  // train_model.py compares four methods. Ranked by the adversarial score, because that is the
  // only column in its report where the methods actually differ.
  const mc = d.modelComparison as any
  const hard = mc?.splits?.hard ?? mc
  const results = hard?.results ?? mc?.results ?? {}
  const adversarialSummary = mc?.adversarial_evaluation?.summary ?? {}

  const methodRanking =
    mc && Object.keys(adversarialSummary).length > 0
      ? Object.entries(adversarialSummary)
          .map(([key, v]: [string, any]) => ({
            key,
            label: METHOD_LABEL[key] ?? key,
            heldOut:
              results[key]?.test_average_precision ??
              results[key]?.test_at_operating_threshold?.precision ??
              null,
            ...v,
          }))
          .sort((a, b) => b.accuracy - a.accuracy)
      : []

  // Every method scored on the held-out split, including the unlabelled control.
  const saturation =
    mc && Object.keys(results).length > 0
      ? Object.entries(results).map(([key, r]: [string, any]) => {
          const ap = r.test_average_precision ?? r.test_at_operating_threshold?.precision ?? 0
          return {
            label: METHOD_LABEL[key] ?? key,
            value: ap,
            valueText: typeof ap === "number" ? ap.toFixed(3) : String(ap),
            note: key === "isolation_forest_unsupervised" ? "no labels at all" : undefined,
            highlight: key === "isolation_forest_unsupervised",
          }
        })
      : []

  const featureImportance = hard?.feature_importance ?? mc?.random_forest_feature_importance ?? []
  const topFeature = featureImportance[0]?.importance ?? 1
  const featureRows = featureImportance.slice(0, 8).map((f: any) => ({
    label: FEATURE_LABEL[f.feature] ?? f.feature.replace(/_/g, " "),
    value: f.importance / topFeature,
    valueText: f.importance.toFixed(3),
    highlight: HAND_WEIGHTED.has(f.feature),
  }))

  const curve: CurvePoint[] = (d.thresholdSelection?.curve ?? []).map((p) => ({
    x: p.threshold,
    recall: p.recall ?? 0,
    precision: p.precision,
  }))

  const failures = d.stressTest?.results.filter((r) => !r.correct) ?? []
  const passes = d.stressTest?.results.filter((r) => r.correct) ?? []

  return (
    <PageShell size="lg">
      <ChartPalette />
      <AnimatedChartStyles />
      <PageHeader
        title="Evidence"
        description="Everything this detector has been measured on, including the cases it gets wrong. All of it reproducible from the repository."
      />

      <div className="space-y-6">
        {/* ------------------------------------------------ held-out accuracy */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">1 · Held-out accuracy</CardTitle>
          </CardHeader>
          <CardContent>
            {dm ? (
              <>
                <div className="grid gap-6 sm:grid-cols-3">
                  <div>
                    <div className="text-muted-foreground text-xs">Rings caught</div>
                    <div className="mt-0.5 text-3xl font-semibold tabular-nums">
                      {pct(dm.recall_true_rings)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">
                      Of what it flags, really a ring
                    </div>
                    <div className="mt-0.5 text-3xl font-semibold tabular-nums">
                      {pct(dm.precision_predicted_clusters)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Households wrongly flagged</div>
                    <div className="mt-0.5 text-3xl font-semibold tabular-nums">
                      {dm.n_lookalikes_wrongly_flagged} / {dm.n_lookalikes}
                    </div>
                  </div>
                </div>
                <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                  Measured on a split the detector never saw. Without a decision threshold
                  (surfacing every connected group, which is what the first version did), precision
                  on the same split is <strong>{pct(dm.precision_without_threshold)}</strong>. The
                  gain came from scoring corroboration instead of connection density.
                </p>
              </>
            ) : (
              <Missing file="detector_metrics.json" cmd={d.howToRegenerate.detectorMetrics} />
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------ adversarial */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">2 · Adversarial cases, including the failures</CardTitle>
          </CardHeader>
          <CardContent>
            {d.stressTest ? (
              <div className="space-y-5">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  The held-out households are easy: they share exactly one thing. These{" "}
                  {d.stressTest.n_cases} cases are deliberately harder on both sides: messier
                  households, more evasive rings. Score:{" "}
                  <strong>
                    {d.stressTest.n_correct} of {d.stressTest.n_cases}
                  </strong>
                  .
                </p>

                {failures.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Where it fails</h3>
                    {failures.map((f) => (
                      <div key={f.case} className="rounded-lg border border-amber-500/30 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                            <RiAlertLine className="size-3.5" aria-hidden />
                            {f.expectation === "not_flagged" ? "False positive" : "False negative"}
                          </span>
                          <span className="font-mono text-xs">{f.case}</span>
                          <span className="text-muted-foreground text-xs tabular-nums">
                            scored {f.risk_score}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed">{f.note}</p>
                        <p className="text-muted-foreground mt-1.5 text-xs">
                          Signals present: {f.signal_types_present.join(", ") || "none"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div>
                  <h3 className="mb-2 text-sm font-medium">Cases it handles correctly</h3>
                  <ul className="divide-y rounded-lg border">
                    {passes.map((p) => (
                      <li key={p.case} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                        <RiCheckLine
                          className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                          aria-hidden
                        />
                        <span className="font-mono text-xs">{p.case}</span>
                        <span className="text-muted-foreground ml-auto text-xs">
                          {p.flagged ? "flagged" : "left alone"} · {p.risk_score}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <Missing file="stress_test_report.json" cmd={d.howToRegenerate.stressTest} />
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------ hold verification */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              3 · Replaying {hv?.n_payments ?? 100} payments through the agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hv ? (
              <div className="space-y-5">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  One square per payment, in arrival order. Each was scored using only what had
                  already landed, so at payment 7 the detector cannot know about payment 80.
                </p>

                <ReplayGrid
                  cells={replayCells}
                  legendOrder={["held_fraud", "left_alone", "missed_fraud", "held_legit"]}
                />

                <div className="grid gap-6 sm:grid-cols-3">
                  <div>
                    <div className="text-muted-foreground text-xs">
                      Of what it held, really fraud
                    </div>
                    <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                      {pct(hv.metrics.precision_of_holds)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">
                      Legitimate payments left alone
                    </div>
                    <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                      {pct(hv.metrics.specificity_legitimate_left_alone)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">
                      Recall after an account is seen once
                    </div>
                    <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                      {pct(hv.first_sighting_analysis.recall_after_first_sighting as number | null)}
                    </div>
                  </div>
                </div>

                <div className="bg-muted/40 rounded-lg border p-4">
                  <h3 className="text-sm font-medium">Why the misses happened</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    Every one of the {String(hv.first_sighting_analysis.missed_fraud_payments)}{" "}
                    misses was that account&apos;s <strong>first ever</strong> payment: no
                    relationships in the graph yet, so nothing to detect. Structural, not a tuning
                    problem. Anything claiming to catch an unseen ring on its first transaction from
                    relationship signals alone is claiming what the data cannot support.
                  </p>
                </div>
              </div>
            ) : (
              <Missing
                file="hold_verification_report.json"
                cmd={d.howToRegenerate.holdVerification}
              />
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------ threshold */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              4 · The threshold was chosen on training data, not by eye
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.thresholdSelection ? (
              <div className="space-y-4">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Selected on the training split by a rule fixed in advance, then applied unchanged
                  to the held-out split. Chosen value:{" "}
                  <strong className="tabular-nums">
                    {d.thresholdSelection.selected_threshold}
                  </strong>
                  .
                </p>
                <ThresholdCurve
                  points={curve}
                  selected={d.thresholdSelection.selected_threshold}
                  bandFrom={
                    d.thresholdSelection.score_separation_on_train.highest_unflagged_score ??
                    undefined
                  }
                  bandTo={
                    d.thresholdSelection.score_separation_on_train.lowest_flagged_score ?? undefined
                  }
                />
                <p className="text-muted-foreground text-xs">
                  Nothing scores inside the shaded band, so the exact cut within it changes nothing.
                  An earlier hand-guessed 0.60 would have cost 23% of recall, which is why this is
                  chosen by script.
                </p>
              </div>
            ) : (
              <Missing file="threshold_selection.json" cmd={d.howToRegenerate.thresholdSelection} />
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------ model comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">5 &middot; Would a trained model do better?</CardTitle>
          </CardHeader>
          <CardContent>
            {mc ? (
              <div className="space-y-5">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Three supervised models, trained on the same graph features, selected by
                  stratified 5-fold cross-validation inside the training split, then run against the
                  adversarial cases in section 2.
                </p>

                <GroupedBars
                  rows={methodRanking.map((r, i) => ({
                    label: r.label,
                    highlight: i === 0,
                    bars: [
                      {
                        seriesIndex: 0,
                        value: r.heldOut ?? 0,
                        valueText: (r.heldOut ?? 0).toFixed(2),
                      },
                      {
                        seriesIndex: 1,
                        value: r.accuracy,
                        valueText: `${r.correct}/${r.total}`,
                      },
                    ],
                  }))}
                  series={[
                    {
                      label: "Held-out split",
                      color: "color-mix(in oklab, var(--chart-benign) 70%, transparent)",
                    },
                    { label: "Adversarial cases", color: "var(--chart-strong)" },
                  ]}
                />

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="bg-muted/40 border-b">
                        <th className="p-3 text-left font-medium">Method</th>
                        <th className="p-3 text-left font-medium">Held-out AP</th>
                        <th className="p-3 text-left font-medium">Adversarial</th>
                        <th className="p-3 text-left font-medium">Failed on</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {methodRanking.map((r, i) => (
                        <tr key={r.key} className={i === 0 ? "bg-emerald-500/5" : undefined}>
                          <td className="p-3 align-top font-medium">{r.label}</td>
                          <td className="p-3 align-top tabular-nums">
                            {r.heldOut === null ? "-" : r.heldOut.toFixed(3)}
                          </td>
                          <td className="p-3 align-top font-semibold tabular-nums">
                            {r.correct} / {r.total}
                          </td>
                          <td className="text-muted-foreground p-3 align-top text-xs">
                            {r.failures.length === 0
                              ? "nothing"
                              : r.failures.map((f: any) => f.case.replace(/_/g, " ")).join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="bg-muted/40 space-y-4 rounded-lg border p-4">
                  <h3 className="text-sm font-medium">Why the held-out column is all ties</h3>
                  <RankBars rows={saturation} />
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    The highlighted row is an isolation forest fitted with{" "}
                    <strong>no labels at all</strong>. A score an unlabelled model matches is
                    measuring the split, not the method: train and test come from one generator, so
                    memorising the generator is enough.
                  </p>
                </div>

                <div className="rounded-lg border p-4">
                  <h3 className="mb-4 text-sm font-medium">What the forest actually keyed on</h3>
                  <RankBars rows={featureRows} />
                  <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                    Highlighted bars are signals the corroboration score already weights by hand. It
                    rediscovered the heuristic rather than beating it, and a merchant can be shown a
                    corroboration score&apos;s reason for a hold.
                  </p>
                </div>
              </div>
            ) : (
              <Missing file="model_comparison.json" cmd={d.howToRegenerate.modelComparison} />
            )}
          </CardContent>
        </Card>

        <div className="rounded-lg border p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <RiFlaskLine className="size-4" aria-hidden />
            What none of this proves
          </h3>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Every number above is measured on synthetic data whose generator encodes the same
            assumption the detector encodes: that honest households share an address but not a
            sequential phone block or a funnelled promo code. That validates the{" "}
            <em>implementation</em>. It cannot validate the <em>assumption</em>, because the same
            belief authored both sides. Real validation needs real merchant traffic with real
            chargeback outcomes.{" "}
            <Link href="/connect" className="underline underline-offset-4">
              Connecting your account
            </Link>{" "}
            is what starts producing that.
          </p>
        </div>
      </div>
    </PageShell>
  )
}
