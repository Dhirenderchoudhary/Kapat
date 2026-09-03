import {
  RiArrowLeftLine,
  RiCheckDoubleLine,
  RiCustomerService2Line,
  RiNodeTree,
  RiShieldCheckLine,
  RiSparklingLine,
} from "@remixicon/react"
import Link from "next/link"
import { notFound } from "next/navigation"

import { ClusterDecide } from "@/components/fraud/cluster-decide"
import { buildEvidenceSentences } from "@/components/fraud/cluster-evidence"
import { ClusterNetworkGraph } from "@/components/fraud/cluster-network-graph"
import {
  RISK_BAND_LABEL,
  RISK_BAND_STYLE,
  SIGNAL_CLASS_LABEL,
  SIGNAL_CLASS_STYLE,
  SIGNAL_INNOCENT_EXPLANATION,
  SIGNAL_LABEL,
  riskBand,
  signalClassOf,
} from "@/components/fraud/signal-taxonomy"
import { PageHeader } from "@/components/shell/page-header"
import { PageShell } from "@/components/shell/page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiClient, unwrap } from "@/lib/api/client"
import { absoluteTime } from "@/lib/time"
import { cn } from "@/lib/utils"

export const dynamic = "force-dynamic"

function formatRupees(paise: number | null): string {
  if (paise === null) return "₹0"
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

const VERIFICATION_LABEL: Record<string, string> = {
  not_yet_triggered: "Not called",
  verified_legitimate: "Says legitimate",
  verified_linked: "Denied knowing",
  unclear: "Unclear",
  no_response: "No response",
}

type DetectionRecord = {
  explanation?: unknown
  riskScore?: unknown
  flagThreshold?: unknown
  ceilingApplied?: unknown
}

function detectionReasoning(auditLog: { payload: unknown }[]): string[] | null {
  for (const entry of auditLog) {
    const payload = entry.payload as { event?: unknown } & DetectionRecord
    if (payload?.event !== "cluster_detected") continue
    const explanation = payload.explanation
    if (Array.isArray(explanation) && explanation.every((line) => typeof line === "string")) {
      return explanation as string[]
    }
  }
  return null
}

export default async function ClusterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data: cluster, error } = await unwrap(apiClient.clusters[":id"].$get({ param: { id } }))

  if (error?.code === "NOT_FOUND") notFound()
  if (error || !cluster) {
    return (
      <PageShell size="lg">
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-6">
          Could not load this ring cluster: {error?.message}
        </div>
      </PageShell>
    )
  }

  const sentences = buildEvidenceSentences(cluster.evidence)
  const reasoning = detectionReasoning(cluster.auditLog)
  const band = riskBand(cluster.riskScore)

  const order = { strong_fraud_specific: 0, weak_fraud_specific: 1, benign_explainable: 2 } as const
  const grouped = [...sentences].sort(
    (a, b) => order[signalClassOf(a.signalType)] - order[signalClassOf(b.signalType)],
  )

  return (
    <PageShell size="lg" className="space-y-8">
      <div>
        <Button
          render={<Link href="/clusters" />}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground mb-4 -ml-2 gap-1"
        >
          <RiArrowLeftLine className="size-4" aria-hidden />
          <span>Back to Ring Queue</span>
        </Button>

        <PageHeader
          title={`Fraud Ring Case #${cluster.id.slice(0, 10)}`}
          description={`${cluster.accountCount} linked accounts · Detected ${absoluteTime(cluster.createdAt)}`}
          actions={
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-muted-foreground text-xs tracking-wider uppercase">
                  Risk Score
                </div>
                <div className="text-foreground text-2xl font-bold tabular-nums">
                  {cluster.riskScore.toFixed(2)}
                </div>
              </div>
              <Badge
                className={cn(
                  "px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                  RISK_BAND_STYLE[band],
                )}
              >
                {RISK_BAND_LABEL[band]}
              </Badge>
            </div>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Detector Reasoning & Evidence */}
        <div className="space-y-6 lg:col-span-7">
          <Card className="glass-panel border-border shadow-sm">
            <CardHeader className="pb-3">
              <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
                <RiSparklingLine className="size-4 text-emerald-500" aria-hidden />
                <span>Detector Audit Reasoning</span>
              </div>
              <CardTitle className="text-lg font-bold">
                Why the Corroboration Engine Flagged This
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reasoning ? (
                <ul className="space-y-2.5 text-sm sm:text-base">
                  {reasoning.map((line) => (
                    <li key={line} className="bg-muted/30 flex items-start gap-3 rounded-lg p-3">
                      <div className="bg-primary mt-1 size-2 shrink-0 rounded-full" />
                      <span className="text-foreground leading-relaxed">{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  No automated audit reasoning was stored with this cluster.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Evidence Breakdown */}
          <Card className="glass-panel border-border shadow-sm">
            <CardHeader className="pb-3">
              <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
                <RiCheckDoubleLine className="size-4 text-blue-500" aria-hidden />
                <span>Multi-Signal Matrix</span>
              </div>
              <CardTitle className="text-lg font-bold">Signal Evidence Breakdown</CardTitle>
              <CardDescription className="text-xs">
                Signals ordered by fraud specificity: strong fraud signals lead, innocent household
                patterns follow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {grouped.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No labeled signals recorded for this cluster.
                </p>
              ) : (
                <ul className="space-y-3.5">
                  {grouped.map((s) => {
                    const cls = signalClassOf(s.signalType)
                    return (
                      <li
                        key={s.signalType}
                        className={cn(
                          "rounded-xl border p-4 shadow-sm",
                          cls === "strong_fraud_specific" &&
                            "border-destructive/30 bg-destructive/5",
                          cls === "weak_fraud_specific" && "border-amber-500/30 bg-amber-500/5",
                          cls === "benign_explainable" && "border-border/80 bg-card/60",
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-foreground text-sm font-bold">
                            {SIGNAL_LABEL[s.signalType] ?? s.signalType}
                          </span>
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
                              SIGNAL_CLASS_STYLE[cls],
                            )}
                          >
                            {SIGNAL_CLASS_LABEL[cls]}
                          </span>
                        </div>
                        <p className="text-foreground mt-2 text-sm leading-relaxed">{s.sentence}</p>
                        <div className="bg-background/60 text-muted-foreground mt-3 rounded-lg p-2.5 text-xs">
                          <span className="text-foreground font-semibold">
                            Innocent explanation:{" "}
                          </span>
                          {SIGNAL_INNOCENT_EXPLANATION[s.signalType] ??
                            "No documented household explanation for this signal."}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Interactive Network Graph */}
          <div className="glass-panel overflow-hidden rounded-xl border p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RiNodeTree className="text-primary size-5" aria-hidden />
                <h3 className="text-foreground text-base font-bold">Interactive Cluster Graph</h3>
              </div>
              <span className="text-muted-foreground font-mono text-xs">
                {cluster.accounts.length} nodes · {cluster.evidence.length} edges
              </span>
            </div>
            <ClusterNetworkGraph accounts={cluster.accounts} evidence={cluster.evidence} />
          </div>
        </div>

        {/* Right Column: Decision & Voice Verification */}
        <div className="space-y-6 lg:col-span-5">
          <Card className="glass-panel border-border shadow-lg">
            <CardHeader className="pb-3">
              <div className="text-primary flex items-center gap-2 text-xs font-medium tracking-wider uppercase">
                <RiShieldCheckLine className="size-4 text-emerald-500" aria-hidden />
                <span>Operator Decision</span>
              </div>
              <CardTitle className="text-lg font-bold">Review &amp; Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card/60 rounded-xl border p-3.5">
                  <div className="text-muted-foreground text-xs font-medium">
                    Chargeback Exposure
                  </div>
                  <div className="text-foreground mt-1 text-xl font-bold tabular-nums">
                    {formatRupees(cluster.chargebackExposurePaise)}
                  </div>
                </div>
                <div className="bg-card/60 rounded-xl border p-3.5">
                  <div className="text-muted-foreground text-xs font-medium">AI Verification</div>
                  <div className="text-foreground mt-1 text-sm font-semibold">
                    {VERIFICATION_LABEL[cluster.verificationStatus] ?? cluster.verificationStatus}
                  </div>
                </div>
              </div>

              {/* Voice AI Verification Transcripts */}
              {cluster.verifications.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                    <RiCustomerService2Line className="text-primary size-4" />
                    <span>Voice AI Call Transcript</span>
                  </div>
                  {cluster.verifications.map((v) => (
                    <div key={v.id} className="bg-muted/40 rounded-xl border p-3.5 text-xs">
                      <div className="text-muted-foreground flex items-center justify-between border-b pb-2">
                        <span className="font-semibold uppercase">{v.languageCode}</span>
                        <span className="text-foreground font-medium">
                          {VERIFICATION_LABEL[v.verificationStatus] ?? v.verificationStatus}
                        </span>
                      </div>
                      {v.transcript && (
                        <p className="text-foreground mt-2 font-mono leading-relaxed italic">
                          &ldquo;{v.transcript}&rdquo;
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <ClusterDecide
                clusterId={cluster.id}
                status={cluster.status}
                latestDecision={cluster.decisions[0] ?? null}
              />

              <div className="bg-muted/30 text-muted-foreground rounded-lg p-3 text-xs">
                Decisions are persisted into the immutable audit log and directly update merchant
                reporting metrics.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
