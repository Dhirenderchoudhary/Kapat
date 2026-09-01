import { RiAlertLine, RiCheckLine, RiFlaskLine } from "@remixicon/react"
import Link from "next/link"

import { BarChart, ChartPalette, ShareBar } from "@/components/fraud/charts"
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
    confusion_matrix: Record<string, number>
    metrics: Record<string, number | null>
    class_balance: Record<string, number>
    first_sighting_analysis: Record<string, number | string | null>
  } | null

  const failures = d.stressTest?.results.filter((r) => !r.correct) ?? []
  const passes = d.stressTest?.results.filter((r) => r.correct) ?? []

  return (
    <PageShell size="lg">
      <ChartPalette />
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
                  Payments replayed one at a time, in order, with the graph rebuilt after each one
                  from only what had arrived so far: so at payment 7 the detector cannot know about
                  payment 80. For each, the question the live system asks: hold it, or let it
                  through?
                </p>

                <ShareBar
                  segments={[
                    {
                      label: "Held, actually fraud",
                      value: hv.confusion_matrix.held_and_fraud_true_positive,
                      color: "var(--chart-strong)",
                    },
                    {
                      label: "Released, actually legitimate",
                      value: hv.confusion_matrix.released_and_legitimate_true_negative,
                      color: "var(--chart-benign)",
                    },
                    {
                      label: "Released, actually fraud (missed)",
                      value: hv.confusion_matrix.released_but_fraud_false_negative,
                      color: "var(--chart-weak)",
                    },
                    {
                      label: "Held, actually legitimate",
                      value: hv.confusion_matrix.held_but_legitimate_false_positive,
                      color: "#8b8b8b",
                    },
                  ]}
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
                    missed payments was that account&apos;s <strong>first ever</strong> payment. On
                    a first payment an account has no relationships in the graph, so there is
                    nothing to detect: this is structural, not a tuning problem. Once an account had
                    been seen once, recall was{" "}
                    {pct(hv.first_sighting_analysis.recall_after_first_sighting as number | null)}.
                  </p>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    Any product claiming to catch a previously-unseen ring on its very first
                    transaction, from relationship signals alone, is claiming something the data
                    cannot support.
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
                <BarChart
                  data={d.thresholdSelection.curve
                    .filter((p) => p.recall !== null)
                    .map((p) => ({
                      label: String(p.threshold),
                      value: p.recall ?? 0,
                      // Formatted server-side: BarChart is a client component, and passing a
                      // formatter function across that boundary throws at render.
                      valueText: `recall ${((p.recall ?? 0) * 100).toFixed(0)}%`,
                      color:
                        p.threshold === d.thresholdSelection!.selected_threshold
                          ? "var(--chart-strong)"
                          : "var(--chart-benign)",
                      sublabel: `precision ${p.precision === null ? "n/a" : (p.precision * 100).toFixed(0) + "%"}`,
                    }))}
                  height={150}
                />
                <p className="text-muted-foreground text-xs">
                  Recall on the training split at each candidate threshold. The highlighted bar is
                  the one selected. An earlier hand-guessed 0.60 would have cost 23% of recall,
                  which is why this is chosen by script.
                </p>
              </div>
            ) : (
              <Missing file="threshold_selection.json" cmd={d.howToRegenerate.thresholdSelection} />
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
