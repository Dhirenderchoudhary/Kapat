import {
  RiBarChartGroupedLine,
  RiCheckDoubleLine,
  RiExchangeDollarLine,
  RiFlashlightLine,
  RiFundsBoxLine,
  RiInformationLine,
  RiPieChartLine,
  RiShieldCheckLine,
  RiUserSharedLine,
} from "@remixicon/react"

import { BarChart, ChartPalette, RankedBars, ShareBar } from "@/components/fraud/charts"
import { SIGNAL_LABEL } from "@/components/fraud/signal-taxonomy"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, unwrap } from "@/lib/api/client"

export const dynamic = "force-dynamic"

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

const CLASS_COLOR: Record<string, string> = {
  benign_explainable: "var(--chart-benign)",
  weak_fraud_specific: "var(--chart-weak)",
  strong_fraud_specific: "var(--chart-strong)",
}

const CLASS_NOTE: Record<string, string> = {
  benign_explainable: "Benign-explainable: ordinary household / family pattern",
  weak_fraud_specific: "Weak fraud signal: sometimes observed in shared living",
  strong_fraud_specific: "Strong fraud signal: specific to coordinated syndicate abuse",
}

const FLAG_THRESHOLD = 0.45
const THRESHOLD_BUCKET_INDEX = 3

export default async function AnalysisPage() {
  const { data, error } = await unwrap(apiClient.analytics.$get())

  if (error || !data) {
    return (
      <PageShell size="lg">
        <PageHeader title="Analysis" description="Breakdown of everything ingested." />
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-6">
          <p className="text-sm font-semibold">Could not load analytics: {error?.message}</p>
          <p className="text-muted-foreground mt-2 text-xs">
            Verify the API service is active and accessible at{" "}
            <code className="font-mono">/api/analytics</code>.
          </p>
        </div>
      </PageShell>
    )
  }

  const {
    totals,
    flaggedShare,
    riskDistribution,
    signalBreakdown,
    clusterSizes,
    statusBreakdown,
    decisionBreakdown,
  } = data
  const flaggedPct =
    totals.accounts > 0 ? (flaggedShare.accountsFlagged / totals.accounts) * 100 : 0

  return (
    <PageShell size="lg" className="space-y-8">
      <ChartPalette />
      <PageHeader
        title="Analysis"
        description="Across every account and transaction currently loaded."
      />

      {/* KPI Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Transactions Ingested
            </span>
            <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
              <RiExchangeDollarLine className="size-4.5" />
            </div>
          </div>
          <div className="text-foreground mt-2 text-2xl font-bold tabular-nums">
            {totals.transactions.toLocaleString("en-IN")}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">
            {rupees(totals.transactionVolumePaise)} total volume
          </div>
        </div>

        <div className="glass-card-hover border-border/80 bg-card/60 rounded-xl border p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              Total Accounts
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <RiUserSharedLine className="size-4.5" />
            </div>
          </div>
          <div className="text-foreground mt-2 text-2xl font-bold tabular-nums">
            {totals.accounts.toLocaleString("en-IN")}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">
            {totals.accountsInFlaggedRings.toLocaleString("en-IN")} in flagged rings (
            {flaggedPct.toFixed(1)}%)
          </div>
        </div>

        <div className="glass-card-hover border-destructive/30 bg-destructive/5 rounded-xl border p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-destructive text-xs font-semibold tracking-wider uppercase">
              Flagged Rings
            </span>
            <div className="bg-destructive/10 text-destructive flex size-8 animate-pulse items-center justify-center rounded-lg">
              <RiFlashlightLine className="size-4.5" />
            </div>
          </div>
          <div className="text-destructive mt-2 text-2xl font-bold tabular-nums">
            {totals.clustersFlagged.toLocaleString("en-IN")}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">
            Risk score &ge; {FLAG_THRESHOLD} threshold
          </div>
        </div>

        <div className="glass-card-hover rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
              Protected Exposure
            </span>
            <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <RiFundsBoxLine className="size-4.5" />
            </div>
          </div>
          <div className="text-foreground mt-2 text-2xl font-bold tabular-nums">
            {rupees(flaggedShare.exposurePaise)}
          </div>
          <div className="text-muted-foreground mt-1 text-xs">
            Potential chargebacks intercepted
          </div>
        </div>
      </div>

      {/* Traffic Implication Share Bars */}
      <Card className="glass-panel border-border shadow-sm">
        <CardHeader className="pb-3">
          <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
            <RiPieChartLine className="size-4 text-emerald-500" aria-hidden />
            <span>Traffic Isolation Share</span>
          </div>
          <CardTitle className="text-lg font-bold">Implicated Traffic Breakdown</CardTitle>
          <CardDescription className="text-xs">
            Proportion of customer accounts and payment volume categorized into coordinated rings vs
            legitimate clean traffic.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="text-foreground mb-2.5 flex items-center justify-between text-sm font-semibold">
              <span>Customer Accounts Distribution</span>
              <span className="text-muted-foreground font-mono text-xs">
                {totals.accounts.toLocaleString("en-IN")} accounts
              </span>
            </div>
            <ShareBar
              segments={[
                {
                  label: "In a flagged ring",
                  value: flaggedShare.accountsFlagged,
                  color: "var(--chart-strong)",
                },
                {
                  label: "Legitimate clean accounts",
                  value: flaggedShare.accountsClean,
                  color: "var(--chart-benign)",
                },
              ]}
              caption={
                flaggedPct > 25
                  ? "Note: Over 25% of your accounts reside in flagged rings. Check whether a high-density corporate hub or campus Wi-Fi is over-linking before taking mass action."
                  : undefined
              }
            />
          </div>
          <div>
            <div className="text-foreground mb-2.5 flex items-center justify-between text-sm font-semibold">
              <span>Transaction Volume Distribution</span>
              <span className="text-muted-foreground font-mono text-xs">
                {totals.transactions.toLocaleString("en-IN")} txns
              </span>
            </div>
            <ShareBar
              segments={[
                {
                  label: "By accounts in a flagged ring",
                  value: flaggedShare.transactionsInFlaggedRings,
                  color: "var(--chart-strong)",
                },
                {
                  label: "Clean merchant orders",
                  value: flaggedShare.transactionsClean,
                  color: "var(--chart-benign)",
                },
              ]}
            />
          </div>
        </CardContent>
      </Card>

      {/* Risk Distribution and Signal Breakdown */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-panel border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
              <RiBarChartGroupedLine className="size-4 text-emerald-500" aria-hidden />
              <span>Scoring Distribution</span>
            </div>
            <CardTitle className="text-lg font-bold">Cluster Risk Score Distribution</CardTitle>
            <CardDescription className="text-xs">
              Groups to the right of the dashed line exceed the {FLAG_THRESHOLD} threshold and enter
              the operator review queue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BarChart
              data={riskDistribution.map((b, i) => ({
                label: b.label,
                value: b.count,
                valueText: `${b.count} ${b.count === 1 ? "group" : "groups"}`,
                color: i > THRESHOLD_BUCKET_INDEX ? "var(--chart-strong)" : "var(--chart-benign)",
                sublabel: i > THRESHOLD_BUCKET_INDEX ? "flagged" : "benign",
              }))}
              markerAt={THRESHOLD_BUCKET_INDEX}
              markerLabel={`Dashed line indicates the ${FLAG_THRESHOLD} threshold. Benign groups to the left are never burdened with manual reviews.`}
            />
          </CardContent>
        </Card>

        <Card className="glass-panel border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
              <RiCheckDoubleLine className="size-4 text-blue-500" aria-hidden />
              <span>Signal Ranking</span>
            </div>
            <CardTitle className="text-lg font-bold">Active Signal Trigger Frequency</CardTitle>
            <CardDescription className="text-xs">
              Which linkage signals are active across the graph, categorized by fraud specificity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankedBars
              data={signalBreakdown.map((s) => ({
                label: SIGNAL_LABEL[s.signalType] ?? s.signalType,
                value: s.edges,
                valueText: `${s.edges.toLocaleString("en-IN")} ${s.edges === 1 ? "link" : "links"}`,
                color: CLASS_COLOR[s.signalClass] ?? "var(--chart-benign)",
                note: CLASS_NOTE[s.signalClass],
              }))}
            />
            <div className="bg-muted/40 text-muted-foreground mt-4 flex items-start gap-2 rounded-lg p-3 text-xs">
              <RiInformationLine className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Red signals (device fingerprints, sequential phone numbers) are impossible for
                ordinary households to produce and directly drive high-confidence flagging.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cluster Sizes & Funnel */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-panel border-border shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-bold">Flagged Ring Sizes</CardTitle>
            <CardDescription className="text-xs">
              Distribution of account counts within detected clusters.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {clusterSizes.length === 0 ? (
              <p className="text-muted-foreground text-sm">No rings flagged yet.</p>
            ) : (
              <BarChart
                data={clusterSizes.map((c) => ({
                  label: `${c.size}`,
                  value: c.clusters,
                  valueText: `${c.clusters} ${c.clusters === 1 ? "ring" : "rings"}`,
                  color: "var(--chart-strong)",
                  sublabel: `${c.size} accounts each`,
                }))}
                height={150}
              />
            )}
            <p className="text-muted-foreground mt-3 text-xs">Accounts per flagged ring cluster.</p>
          </CardContent>
        </Card>

        <Card className="glass-panel border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
              <RiShieldCheckLine className="size-4 text-emerald-500" aria-hidden />
              <span>Workflow State</span>
            </div>
            <CardTitle className="text-lg font-bold">Operator Review Funnel</CardTitle>
            <CardDescription className="text-xs">
              Status of all flagged clusters across the investigation lifecycle.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                Ring Status
              </div>
              {Object.keys(statusBreakdown).length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing flagged yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {Object.entries(statusBreakdown).map(([status, n]) => (
                    <li
                      key={status}
                      className="bg-card/60 flex items-center justify-between rounded-lg border p-2.5"
                    >
                      <span className="text-foreground font-medium">
                        {status === "pending_review"
                          ? "Awaiting merchant decision"
                          : status === "resolved"
                            ? "Decided & Closed"
                            : "Voice AI verification calling"}
                      </span>
                      <span className="text-foreground font-bold tabular-nums">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t pt-4">
              <div className="text-muted-foreground mb-2 text-xs font-semibold tracking-wider uppercase">
                Decisions Recorded
              </div>
              {Object.keys(decisionBreakdown).length === 0 ? (
                <p className="text-muted-foreground text-xs leading-relaxed">
                  No manual operator decisions yet recorded in the audit log.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {Object.entries(decisionBreakdown).map(([action, n]) => (
                    <li
                      key={action}
                      className="bg-card/60 flex items-center justify-between rounded-lg border p-2.5"
                    >
                      <span className="text-foreground font-medium capitalize">{action}</span>
                      <span className="text-foreground font-bold tabular-nums">{n}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  )
}
